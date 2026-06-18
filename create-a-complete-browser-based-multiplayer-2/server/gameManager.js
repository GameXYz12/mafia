const crypto = require('crypto');
const { createBalancedRoleSet, roleForName, factionForRole, shuffle } = require('./roles');

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function roomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function now() {
  return Date.now();
}

function createGameManager({ storage }) {
  const rooms = new Map();
  const queue = [];
  const INACTIVE_MS = 60 * 1000;
  const SWEEP_MS = 60 * 1000;

  function identityForSocket(socket) {
    if (socket.data.user) {
      return {
        id: socket.data.user.id,
        userId: socket.data.user.id,
        name: socket.data.user.username,
        avatarSeed: socket.data.user.avatarSeed,
        isGuest: false
      };
    }

    if (!socket.data.guestIdentity) {
      const guestId = `guest_${socket.id.slice(0, 10)}`;
      socket.data.guestIdentity = {
        id: guestId,
        userId: null,
        name: `Guest ${socket.id.slice(0, 4).toUpperCase()}`,
        avatarSeed: crypto.createHash('sha1').update(guestId).digest('hex').slice(0, 12),
        isGuest: true
      };
    }

    return socket.data.guestIdentity;
  }

  function makePlayer(identity, socket) {
    return {
      id: identity.id,
      userId: identity.userId,
      socketId: socket.id,
      name: identity.name,
      avatarSeed: identity.avatarSeed,
      isGuest: identity.isGuest,
      ready: false,
      connected: true,
      alive: true,
      spectator: false,
      roleName: null,
      faction: null,
      team: 'Neutral',
      revealed: false,
      statuses: {
        blocked: 0,
        protected: 0,
        poisoned: 0,
        charmed: 0,
        intimidated: 0,
        forged: 0,
        revived: 0
      },
      tempAbility: null,
      chosenTarget: null,
      dayVote: null,
      voteWeight: 1,
      roleCardSeen: false,
      chatCount: 0,
      xp: 0,
      actions: [],
      aliveSince: now(),
      lastActive: now()
    };
  }

  function createRoom(ownerSocket, options = {}) {
    const identity = identityForSocket(ownerSocket);
    const code = roomCode();
    const room = {
      code,
      ownerId: identity.id,
      createdAt: new Date().toISOString(),
      name: String(options.name || 'Nebula Room').slice(0, 40),
      locked: !!options.locked,
      private: !!options.private,
      mode: options.mode === 'ranked' ? 'ranked' : 'casual',
      started: false,
      phase: 'lobby',
      dayNumber: 0,
      winner: null,
      lastPhaseChange: now(),
      settings: {
        maxPlayers: clamp(Number(options.maxPlayers) || 12, 6, 20),
        dayLength: clamp(Number(options.dayLength) || 90, 45, 180),
        voteLength: clamp(Number(options.voteLength) || 45, 20, 120),
        nightLength: clamp(Number(options.nightLength) || 45, 20, 120),
        revealLength: clamp(Number(options.revealLength) || 12, 5, 30),
        allowSpectators: options.allowSpectators !== false,
        publicChatDuringDay: options.publicChatDuringDay !== false,
        customRoles: Array.isArray(options.customRoles) ? options.customRoles : [],
        ranked: !!options.ranked
      },
      players: new Map(),
      spectators: new Map(),
      logs: [],
      chat: [],
      votes: new Map(),
      actions: new Map(),
      incomingWhispers: [],
      moderation: {
        muted: new Set(),
        spamWarnings: new Map()
      },
      timers: {},
      history: [],
      resultQueue: [],
      rolePreview: new Map(),
      roomSecrets: {
        judgePardons: 0,
        adminTimingShift: 0,
        cultPressure: 0
      }
    };

    room.players.set(identity.id, makePlayer(identity, ownerSocket));
    rooms.set(code, room);
    ownerSocket.join(code);
    ownerSocket.join(identity.id);
    ownerSocket.data.roomCode = code;
    ownerSocket.data.identityId = identity.id;
    ownerSocket.data.personalRoom = identity.id;
    log(room, `Room ${room.name} created by ${identity.name}.`);
    syncRoom(room);
    return publicRoom(room);
  }

  function publicRoom(room) {
    return {
      code: room.code,
      name: room.name,
      ownerId: room.ownerId,
      mode: room.mode,
      started: room.started,
      phase: room.phase,
      dayNumber: room.dayNumber,
      playerCount: [...room.players.values()].filter(player => !player.spectator).length,
      spectatorCount: room.spectators.size,
      settings: {
        maxPlayers: room.settings.maxPlayers,
        dayLength: room.settings.dayLength,
        voteLength: room.settings.voteLength,
        nightLength: room.settings.nightLength,
        revealLength: room.settings.revealLength
      }
    };
  }

  function listPublicRooms() {
    return [...rooms.values()].map(publicRoom).filter(room => !room.started || room.settings.allowSpectators);
  }

  function addLog(room, entry, kind = 'system') {
    const line = {
      id: uid('log'),
      kind,
      text: entry,
      at: new Date().toISOString(),
      dayNumber: room.dayNumber,
      phase: room.phase
    };
    room.logs.push(line);
    room.logs = room.logs.slice(-250);
    ioBroadcast(room, 'roomLog', line);
  }

  function log(room, entry) {
    addLog(room, entry, 'system');
  }

  function roomOfSocket(socket) {
    const code = socket.data.roomCode;
    if (!code) return null;
    return rooms.get(code) || null;
  }

  function identityFromSocket(socket) {
    return identityForSocket(socket);
  }

  function playerFor(socket, room = roomOfSocket(socket)) {
    if (!room) return null;
    const identity = identityFromSocket(socket);
    return room.players.get(identity.id) || room.spectators.get(identity.id) || null;
  }

  function ioBroadcast(room, event, payload) {
    if (!room) return;
    for (const player of [...room.players.values(), ...room.spectators.values()]) {
      if (player.socketId) {
        const socket = sockets.get(player.socketId);
        if (socket) socket.emit(event, payload);
      }
    }
  }

  function emitPrivate(room, playerId, event, payload) {
    const player = room.players.get(playerId) || room.spectators.get(playerId);
    if (!player) return;
    const socket = sockets.get(player.socketId);
    if (socket) socket.emit(event, payload);
  }

  function maskPlayer(player, viewerId, room) {
    const isSelf = player.id === viewerId;
    const hiddenLobby = room.phase === 'lobby';
    return {
      id: player.id,
      name: player.name,
      avatarSeed: player.avatarSeed,
      alive: player.alive,
      spectator: player.spectator,
      ready: player.ready,
      roleName: hiddenLobby ? null : (isSelf || room.phase === 'end' ? player.roleName : (player.revealed ? player.roleName : null)),
      faction: hiddenLobby ? null : (isSelf || room.phase === 'end' ? player.faction : (player.revealed ? player.faction : null)),
      team: player.team,
      statuses: {
        blocked: player.statuses.blocked,
        protected: player.statuses.protected,
        poisoned: player.statuses.poisoned,
        charmed: player.statuses.charmed,
        intimidated: player.statuses.intimidated
      },
      voteWeight: player.voteWeight,
      tempAbility: isSelf ? player.tempAbility : null,
      revealed: player.revealed
    };
  }

  function buildStateFor(room, viewerId) {
    const viewer = room.players.get(viewerId) || room.spectators.get(viewerId);
    return {
      room: publicRoom(room),
      viewerId,
      viewerRole: viewer ? viewer.roleName : null,
      viewerFaction: viewer ? viewer.faction : null,
      viewerAlive: viewer ? viewer.alive : false,
      players: [...room.players.values()].map(player => maskPlayer(player, viewerId, room)),
      spectators: [...room.spectators.values()].map(player => ({
        id: player.id,
        name: player.name,
        avatarSeed: player.avatarSeed,
        connected: player.connected
      })),
      logs: room.logs.slice(-80),
      chat: room.chat.filter(message => chatVisibleTo(room, message, viewerId)).slice(-100),
      winner: room.winner,
      votes: room.phase === 'vote' || room.phase === 'end' ? summarizeVotes(room) : [],
      actionsReady: room.phase === 'night' ? [...room.players.values()].filter(player => player.alive && !player.spectator).length : 0,
      settings: room.settings,
      roleCatalog: getRoleCatalogCached()
    };
  }

  let cachedCatalog = null;
  function getRoleCatalogCached() {
    if (!cachedCatalog) {
      cachedCatalog = require('./roles').getRoleCatalog();
    }
    return cachedCatalog;
  }

  function syncRoom(room) {
    for (const player of [...room.players.values(), ...room.spectators.values()]) {
      emitPrivate(room, player.id, 'roomState', buildStateFor(room, player.id));
      if (room.phase === 'reveal' && player.roleName) {
        emitPrivate(room, player.id, 'privateRole', {
          role: roleForName(player.roleName),
          canChat: false,
          code: room.code
        });
      }
    }
    ioBroadcast(room, 'roomSummary', publicRoom(room));
  }

  function markActivity(socket) {
    const room = roomOfSocket(socket);
    const identity = identityFromSocket(socket);
    socket.data.lastActivity = now();
    if (!room) return;
    const player = room.players.get(identity.id) || room.spectators.get(identity.id);
    if (player) {
      player.lastActive = now();
      player.connected = true;
      player.socketId = socket.id;
    }
  }

  function startTimer(room, phase, durationMs, next) {
    if (room.timers.phase) clearTimeout(room.timers.phase);
    room.timers.phase = setTimeout(() => next(room), durationMs);
    room.lastPhaseChange = now();
    room.phase = phase;
    syncRoom(room);
  }

  function alivePlayers(room, includeSpectators = false) {
    return [...room.players.values()].filter(player => (includeSpectators || !player.spectator) && player.alive);
  }

  function nonSpectatorPlayers(room) {
    return [...room.players.values()].filter(player => !player.spectator);
  }

  function canStart(room) {
    return nonSpectatorPlayers(room).length >= 6;
  }

  function assignRoles(room) {
    const players = nonSpectatorPlayers(room);
    const roleSet = room.settings.customRoles.length >= players.length
      ? shuffle(room.settings.customRoles).slice(0, players.length)
      : createBalancedRoleSet(players.length, room.settings);
    const shuffledPlayers = shuffle(players);
    shuffledPlayers.forEach((player, index) => {
      const roleName = roleSet[index] || 'Cop';
      player.roleName = roleName;
      player.faction = factionForRole(roleName);
      player.team = roleForName(roleName)?.team || 'Unknown';
      player.revealed = false;
      player.alive = true;
      player.spectator = false;
      player.statuses = {
        blocked: 0,
        protected: 0,
        poisoned: 0,
        charmed: 0,
        intimidated: 0,
        forged: 0,
        revived: 0
      };
      player.tempAbility = null;
      player.dayVote = null;
      player.voteWeight = 1;
      player.roleCardSeen = false;
      player.actions = [];
    });
  }

  function beginGame(room) {
    if (!canStart(room)) throw new Error('At least 6 active players are required.');
    room.started = true;
    room.dayNumber = 0;
    room.winner = null;
    room.votes.clear();
    room.actions.clear();
    assignRoles(room);
    room.rolePreview.clear();
    room.phase = 'reveal';
    room.logs = [];
    room.chat = [];
    addLog(room, 'Role assignment complete. Check your private reveal screen.');
    for (const player of nonSpectatorPlayers(room)) {
      emitPrivate(room, player.id, 'privateRole', {
        role: roleForName(player.roleName),
        code: room.code,
        phase: 'reveal',
        canChat: false,
        factionHint: player.roleName === 'Beast Man' ? 'You seem innocent.' : null
      });
    }
    syncRoom(room);
    startTimer(room, 'reveal', room.settings.revealLength * 1000, () => {
      room.dayNumber = 1;
      enterDay(room, 'The city wakes to a new investigation.');
    });
  }

  function enterDay(room, message = 'Day discussion begins.') {
    room.votes.clear();
    room.actions.clear();
    room.chat = room.chat.slice(-80);
    room.phase = 'day';
    room.dayNumber = Math.max(1, room.dayNumber);
    for (const player of room.players.values()) {
      player.dayVote = null;
      player.statuses.intimidated = Math.max(0, player.statuses.intimidated - 1);
      player.statuses.charmed = Math.max(0, player.statuses.charmed - 1);
      player.voteWeight = player.roleName === 'Politician' ? 2 : 1;
    }
    addLog(room, message);
    startTimer(room, 'day', room.settings.dayLength * 1000, () => enterVote(room));
  }

  function enterVote(room) {
    room.phase = 'vote';
    room.votes.clear();
    room.logs.push({
      id: uid('log'),
      kind: 'system',
      text: 'Voting is now open. Use your last chance to make the case.',
      at: new Date().toISOString(),
      dayNumber: room.dayNumber,
      phase: room.phase
    });
    ioBroadcast(room, 'roomLog', room.logs[room.logs.length - 1]);
    syncRoom(room);
    startTimer(room, 'vote', room.settings.voteLength * 1000, () => resolveVote(room));
  }

  function enterNight(room) {
    room.phase = 'night';
    room.actions.clear();
    room.votes.clear();
    addLog(room, `Night ${room.dayNumber} falls. Choose your hidden moves.`);
    startTimer(room, 'night', room.settings.nightLength * 1000, () => resolveNight(room));
  }

  function enterResults(room, summary) {
    if (room.phase === 'end' || room.winner) return;
    room.phase = 'results';
    room.resultQueue = summary;
    addLog(room, summary.text);
    syncRoom(room);
    startTimer(room, 'results', 8000, () => {
      if (checkWinner(room)) return;
      enterDay(room, `Dawn breaks on day ${room.dayNumber}.`);
    });
  }

  function setWinner(room, faction, reason) {
    room.winner = { faction, reason, at: new Date().toISOString() };
    room.phase = 'end';
    room.started = false;
    if (room.timers.phase) clearTimeout(room.timers.phase);
    addLog(room, `${faction.toUpperCase()} wins. ${reason}`);
    finalizeRoom(room, faction);
    syncRoom(room);
  }

  function checkWinner(room) {
    const alive = alivePlayers(room);
    const mafia = alive.filter(player => player.faction === 'mafia');
    const cult = alive.filter(player => player.faction === 'cult');
    const citizen = alive.filter(player => player.faction === 'citizen');
    if (alive.length === 0) {
      setWinner(room, 'draw', 'Everyone perished.');
      return true;
    }
    if (cult.length > 0 && cult.length === alive.length) {
      setWinner(room, 'cult', 'All living players have embraced the cult.');
      return true;
    }
    if (mafia.length > 0 && mafia.length >= alive.length - mafia.length && cult.length === 0) {
      setWinner(room, 'mafia', 'Mafia parity has been reached.');
      return true;
    }
    if (mafia.length === 0 && cult.length === 0 && citizen.length > 0) {
      setWinner(room, 'citizen', 'The city has rooted out the hidden factions.');
      return true;
    }
    return false;
  }

  function resolveVote(room) {
    const tally = summarizeVotes(room);
    if (!tally.length) {
      enterNight(room);
      return;
    }
    const top = tally[0];
    const second = tally[1];
    if (!top || (second && second.votes === top.votes)) {
      addLog(room, 'The vote ends in a tie. No one is executed.');
      enterNight(room);
      return;
    }
    const target = room.players.get(top.id);
    if (!target || !target.alive) {
      enterNight(room);
      return;
    }
    const requiredVotes = target.roleName === 'Politician' ? 2 : 1;
    if (top.votes < requiredVotes) {
      addLog(room, `${target.name} survives the vote due to resistance.`);
      enterNight(room);
      return;
    }
    if (room.roomSecrets.judgePardons === target.id) {
      addLog(room, `Judge pardons ${target.name}; the lynch is cancelled.`);
      room.roomSecrets.judgePardons = null;
      enterNight(room);
      return;
    }
    eliminate(room, target, 'lynch', null);
    addLog(room, `${target.name} was eliminated by vote.`);
    if (!checkWinner(room)) {
      enterNight(room);
    }
  }

  function totalVoteWeight(room, playerId) {
    const player = room.players.get(playerId);
    if (!player || !player.alive) return 0;
    if (player.statuses.intimidated > 0) return 0;
    return player.voteWeight || 1;
  }

  function summarizeVotes(room) {
    const tally = new Map();
    for (const [voterId, targetId] of room.votes.entries()) {
      if (targetId === 'abstain') continue;
      const voter = room.players.get(voterId);
      if (!voter || !voter.alive) continue;
      const weight = totalVoteWeight(room, voterId);
      if (weight <= 0) continue;
      tally.set(targetId, (tally.get(targetId) || 0) + weight);
    }
    return [...tally.entries()].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
  }

  function revealRole(player) {
    player.revealed = true;
  }

  function killIfPossible(room, target, source, attacker) {
    if (!target || !target.alive) return false;
    if (target.statuses.protected > 0) {
      target.statuses.protected -= 1;
      addLog(room, `${target.name} was protected from ${source}.`);
      if (target.roleName === 'Soldier') {
        target.statuses.protected = Math.max(target.statuses.protected, 1);
      }
      return false;
    }
    if (target.roleName === 'Soldier' && target.statuses.revived === 0) {
      target.statuses.revived = 1;
      addLog(room, `${target.name} shrugged off the first fatal attack.`);
      return false;
    }
    if (target.roleName === 'Martyr') {
      target.alive = false;
      revealRole(target);
      addLog(room, `${target.name} dies in a martyr's sacrifice.`);
      if (attacker && attacker.alive) {
        attacker.alive = false;
        revealRole(attacker);
        addLog(room, `${attacker.name} was dragged down by the martyr.`);
      }
      return true;
    }
    target.alive = false;
    revealRole(target);
    return true;
  }

  function eliminate(room, target, source, attacker) {
    return killIfPossible(room, target, source, attacker);
  }

  function applyInvestigationResult(room, investigator, target, kind) {
    let result;
    if (target.roleName === 'Beast Man' && kind !== 'detective') {
      result = kind === 'cop' ? 'Suspicious' : 'Citizen-like';
    } else if (kind === 'cop') {
      result = target.faction === 'mafia' ? 'Mafia' : (target.faction === 'cult' ? 'Cult' : 'Citizen');
    } else if (kind === 'spy') {
      result = `${target.faction.toUpperCase()} | ${target.roleName}`;
    } else if (kind === 'detective') {
      result = target.roleName;
    } else if (kind === 'mentalist') {
      result = investigator.id === target.id ? 'Self' : (investigator.faction === target.faction ? 'Aligned' : 'Divergent');
    } else {
      result = target.faction;
    }
    emitPrivate(room, investigator.id, 'privateResult', {
      kind,
      target: target.name,
      result,
      dayNumber: room.dayNumber
    });
    addLog(room, `${investigator.name} received a private clue.`);
  }

  function resolveNight(room) {
    const actions = [...room.actions.values()];
    const participants = [...room.players.values()].filter(player => player.alive && !player.spectator);
    const byPriority = actions.sort((a, b) => b.priority - a.priority);
    const tempView = new Map();
    const findTarget = (id) => room.players.get(id);

    for (const action of byPriority) {
      const actor = room.players.get(action.actorId);
      if (!actor || !actor.alive) continue;
      if (actor.statuses.blocked > 0) {
        actor.statuses.blocked -= 1;
        emitPrivate(room, actor.id, 'actionResult', { ok: false, reason: 'You were blocked.' });
        continue;
      }
      const target = action.targetId ? findTarget(action.targetId) : null;
      if (target && !room.players.has(target.id)) continue;

      switch (action.type) {
        case 'kill': {
          if (!target) break;
          const success = eliminate(room, target, 'night kill', actor);
          if (success) {
            emitPrivate(room, actor.id, 'actionResult', { ok: true, text: `Your strike hit ${target.name}.` });
            if (actor.roleName === 'Hitman') actor.xp = (actor.xp || 0) + (target.roleName && ['Judge', 'Cop', 'Priest'].includes(target.roleName) ? 3 : 1);
          }
          break;
        }
        case 'block': {
          if (!target) break;
          target.statuses.blocked += 1;
          target.statuses.charmed += 1;
          emitPrivate(room, actor.id, 'actionResult', { ok: true, text: `${target.name} was charmed and blocked.` });
          addLog(room, `${target.name} feels suspiciously distracted.`);
          break;
        }
        case 'protect': {
          if (!target) break;
          target.statuses.protected += 1;
          emitPrivate(room, actor.id, 'actionResult', { ok: true, text: `${target.name} is protected.` });
          break;
        }
        case 'investigate_faction': {
          if (!target) break;
          applyInvestigationResult(room, actor, target, 'cop');
          break;
        }
        case 'investigate_role': {
          if (!target) break;
          applyInvestigationResult(room, actor, target, 'detective');
          break;
        }
        case 'spy': {
          if (!target) break;
          applyInvestigationResult(room, actor, target, 'spy');
          break;
        }
        case 'recruit': {
          if (!target || target.faction === 'cult' || !target.alive) break;
          if (target.statuses.protected > 0) {
            addLog(room, `${target.name} resisted cult recruitment.`);
            break;
          }
          target.faction = 'cult';
          target.team = 'Cult Team';
          if (!['Lover', 'Soldier'].includes(target.roleName)) {
            target.roleName = target.roleName;
          }
          emitPrivate(room, target.id, 'privateResult', { kind: 'conversion', result: 'You have been recruited into the Cult.' });
          addLog(room, `${target.name} has been recruited into the Cult.`);
          break;
        }
        case 'revive': {
          if (!target || target.alive) break;
          target.alive = true;
          target.statuses.revived = 1;
          target.revealed = true;
          addLog(room, `${target.name} was revived by sacred rites.`);
          emitPrivate(room, target.id, 'privateResult', { kind: 'revival', result: 'You have returned to the living.' });
          break;
        }
        case 'steal': {
          if (!target) break;
          actor.tempAbility = target.roleName;
          emitPrivate(room, actor.id, 'actionResult', { ok: true, text: `You copied ${target.name}'s role pattern.` });
          break;
        }
        case 'forge': {
          if (!target) break;
          target.statuses.forged += 1;
          emitPrivate(room, actor.id, 'actionResult', { ok: true, text: `${target.name} will appear falsified.` });
          break;
        }
        case 'attack': {
          if (!target) break;
          killIfPossible(room, target, 'mercenary attack', actor);
          break;
        }
        case 'guard': {
          if (!target) break;
          target.statuses.protected += 2;
          break;
        }
        case 'experiment': {
          const outcomes = ['kill', 'protect', 'block', 'convert'];
          const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
          if (outcome === 'kill' && target) eliminate(room, target, 'experiment', actor);
          else if (outcome === 'protect' && target) target.statuses.protected += 1;
          else if (outcome === 'block' && target) target.statuses.blocked += 1;
          else if (outcome === 'convert' && target) target.faction = target.faction === 'cult' ? 'cult' : 'mafia';
          addLog(room, `Mad Scientist test result: ${outcome}.`);
          break;
        }
        case 'jam': {
          if (!target) break;
          target.statuses.blocked += 1;
          break;
        }
        case 'swap': {
          if (!target || !action.otherTargetId) break;
          const other = findTarget(action.otherTargetId);
          if (!other) break;
          const tmp = target.roleName;
          target.roleName = other.roleName;
          other.roleName = tmp;
          addLog(room, `An illusion confuses identities between ${target.name} and ${other.name}.`);
          break;
        }
        case 'compare': {
          if (!target || !action.otherTargetId) break;
          const other = findTarget(action.otherTargetId);
          const relation = other && target.faction === other.faction ? 'linked' : 'different';
          emitPrivate(room, actor.id, 'privateResult', { kind: 'compare', result: relation, target: target.name, other: other ? other.name : null });
          break;
        }
        case 'vision': {
          const future = room.phase === 'night' ? 'A vote is coming.' : 'The city is restless.';
          emitPrivate(room, actor.id, 'privateResult', { kind: 'vision', result: future });
          break;
        }
        case 'cleanse': {
          if (!target) break;
          target.statuses.blocked = 0;
          target.statuses.protected = Math.max(0, target.statuses.protected - 1);
          target.statuses.poisoned = 0;
          break;
        }
        case 'intimidate': {
          if (!target) break;
          target.statuses.intimidated += 1;
          addLog(room, `${target.name} is too intimidated to speak freely.`);
          break;
        }
        case 'broadcast': {
          if (!action.message) break;
          room.chat.push({
            id: uid('chat'),
            channel: 'public',
            authorId: actor.id,
            authorName: actor.name,
            text: action.message,
            at: new Date().toISOString(),
            system: true
          });
          ioBroadcast(room, 'chatMessage', room.chat[room.chat.length - 1]);
          break;
        }
        case 'condemn': {
          if (!target) break;
          room.roomSecrets.judgePardons = null;
          target.statuses.intimidated += 1;
          break;
        }
        case 'pardon': {
          if (!target) break;
          room.roomSecrets.judgePardons = target.id;
          addLog(room, `Judge prepares a pardon for ${target.name}.`);
          break;
        }
        case 'send_spirit': {
          emitPrivate(room, actor.id, 'privateResult', { kind: 'spirit', result: 'The dead whisper of hidden danger.' });
          break;
        }
        default:
          break;
      }
    }

    for (const player of participants) {
      if (player.statuses.poisoned > 0) {
        player.statuses.poisoned -= 1;
        if (player.statuses.poisoned === 0) eliminate(room, player, 'poison', null);
      }
    }

    const summaryText = buildNightSummary(room);
    if (checkWinner(room)) return;
    enterResults(room, { text: summaryText });
  }

  function buildNightSummary(room) {
    const fallen = [...room.players.values()].filter(player => !player.alive && player.revealed).map(player => player.name);
    if (!fallen.length) return 'Dawn arrives with no confirmed night deaths.';
    return `Night closes with ${fallen.join(', ')} absent from the table.`;
  }

  function finalizeRoom(room, winningFaction) {
    const outcome = winningFaction === 'draw' ? 'draw' : winningFaction;
    for (const player of room.players.values()) {
      const won = player.faction === winningFaction || (winningFaction === 'draw' && true);
      const xp = won ? 120 : 45;
      if (player.userId) {
        storage.addMatchResult({
          userId: player.userId,
          roomCode: room.code,
          roleName: player.roleName || 'Unknown',
          faction: player.faction,
          outcome: won ? 'win' : (winningFaction === 'draw' ? 'draw' : 'loss'),
          xpGained: xp
        }).catch(() => null);
      }
      if (player.socketId) {
        const socket = sockets.get(player.socketId);
        if (socket) {
          socket.emit('gameOver', {
            winner: winningFaction,
            outcome,
            xp,
            role: player.roleName,
            faction: player.faction,
            player
          });
        }
      }
    }
  }

  function setReady(socket, ready) {
    const room = roomOfSocket(socket);
    if (!room) return;
    const identity = identityFromSocket(socket);
    const player = room.players.get(identity.id);
    if (!player || room.started) return;
    player.ready = !!ready;
    addLog(room, `${player.name} is ${player.ready ? 'ready' : 'not ready'}.`);
    syncRoom(room);
  }

  function autoStartIfFull(room) {
    if (!room || room.started) return;
    if (nonSpectatorPlayers(room).length >= room.settings.maxPlayers) {
      beginGame(room);
    }
  }

  function submitAction(socket, payload) {
    const room = roomOfSocket(socket);
    if (!room || room.phase !== 'night') return;
    const identity = identityFromSocket(socket);
    const player = room.players.get(identity.id);
    if (!player || !player.alive || player.spectator) return;
    const targetId = payload.targetId || null;
    const otherTargetId = payload.otherTargetId || null;
    const type = String(payload.type || '').trim();
    const action = {
      id: uid('action'),
      actorId: player.id,
      type,
      targetId,
      otherTargetId,
      message: payload.message ? String(payload.message).slice(0, 180) : null,
      priority: actionPriority(type)
    };
    const existing = room.actions.get(player.id);
    if (existing) {
      room.actions.set(player.id, action);
    } else {
      room.actions.set(player.id, action);
    }
    emitPrivate(room, player.id, 'actionResult', { ok: true, text: 'Night action registered.' });
    syncRoom(room);
  }

  function actionPriority(type) {
    const map = {
      pardon: 95,
      block: 90,
      protect: 80,
      investigate_role: 70,
      investigate_faction: 70,
      spy: 70,
      forge: 70,
      steal: 65,
      compare: 60,
      swap: 60,
      recruit: 85,
      kill: 100,
      attack: 100,
      revive: 40,
      guard: 75,
      intimidate: 72,
      cleanse: 76,
      broadcast: 20,
      vision: 10
    };
    return map[type] || 50;
  }

  function castVote(socket, payload) {
    const room = roomOfSocket(socket);
    if (!room || room.phase !== 'vote') return;
    const identity = identityFromSocket(socket);
    const player = room.players.get(identity.id);
    if (!player || !player.alive || player.spectator) return;
    const targetId = payload.targetId || 'abstain';
    if (targetId !== 'abstain' && !room.players.has(targetId)) return;
    room.votes.set(player.id, targetId);
    player.dayVote = targetId;
    if (player.roleName === 'Gangster' && targetId !== 'abstain') {
      const victim = room.players.get(targetId);
      if (victim) victim.statuses.intimidated += 1;
    }
    syncRoom(room);
  }

  function sendChat(socket, payload) {
    const room = roomOfSocket(socket);
    if (!room) return;
    const identity = identityFromSocket(socket);
    const player = room.players.get(identity.id) || room.spectators.get(identity.id);
    if (!player) return;
    const channel = String(payload.channel || 'public');
    const text = String(payload.text || '').trim().slice(0, 240);
    const whisperTargetId = String(payload.targetId || '').trim() || null;
    if (!text) return;
    if (isSpam(socket, text)) {
      emitPrivate(room, player.id, 'chatError', { error: 'Message rate limited.' });
      return;
    }
    if (!allowChat(room, player, channel)) {
      emitPrivate(room, player.id, 'chatError', { error: 'Chat is not available right now.' });
      return;
    }
    const message = {
      id: uid('chat'),
      channel,
      authorId: player.id,
      authorName: player.name,
      text,
      targetId: whisperTargetId,
      at: new Date().toISOString()
    };
    room.chat.push(message);
    room.chat = room.chat.slice(-200);
    if (socket.data.user) storage.recordChat(socket.data.user.id).catch(() => null);
    syncRoom(room);
    deliverChat(room, message);
  }

  function allowChat(room, player, channel) {
    if (channel === 'public') {
      if (room.phase === 'lobby') return player.alive && !player.spectator;
      return room.phase === 'day' && player.alive && !player.spectator && room.settings.publicChatDuringDay;
    }
    if (channel === 'dead') return !player.alive || player.spectator;
    if (channel === 'spectator') return player.spectator;
    if (channel === 'mafia') return player.faction === 'mafia' || player.spectator;
    if (channel === 'cult') return player.faction === 'cult' || player.spectator;
    if (channel === 'whisper') return true;
    return false;
  }

  function deliverChat(room, message) {
    if (message.channel === 'whisper') {
      const senderSocket = sockets.get(room.players.get(message.authorId)?.socketId);
      const target = room.players.get(message.targetId || '');
      const targetSocket = target && sockets.get(target.socketId);
      if (senderSocket) senderSocket.emit('chatMessage', message);
      if (targetSocket && targetSocket.id !== senderSocket?.id) targetSocket.emit('chatMessage', message);
      return;
    }
    for (const recipient of [...room.players.values(), ...room.spectators.values()]) {
      const socket = sockets.get(recipient.socketId);
      if (!socket) continue;
      const canSee = (
        message.channel === 'public' ||
        message.channel === 'spectator' && recipient.spectator ||
        message.channel === 'dead' && (!recipient.alive || recipient.spectator) ||
        message.channel === 'mafia' && (recipient.faction === 'mafia' || recipient.spectator) ||
        message.channel === 'cult' && (recipient.faction === 'cult' || recipient.spectator)
      );
      if (canSee) socket.emit('chatMessage', message);
    }
  }

  function chatVisibleTo(room, message, viewerId) {
    const viewer = room.players.get(viewerId) || room.spectators.get(viewerId);
    if (!viewer) return false;
    if (message.channel === 'public') return true;
    if (message.channel === 'spectator') return viewer.spectator;
    if (message.channel === 'dead') return !viewer.alive || viewer.spectator;
    if (message.channel === 'mafia') return viewer.faction === 'mafia' || viewer.spectator;
    if (message.channel === 'cult') return viewer.faction === 'cult' || viewer.spectator;
    if (message.channel === 'whisper') return message.authorId === viewerId || message.targetId === viewerId;
    return false;
  }

  function isSpam(socket, text) {
    const history = socket.data.messageHistory || [];
    const timestamps = history.filter(item => now() - item.at < 10000);
    const repeats = timestamps.filter(item => item.text === text);
    timestamps.push({ text, at: now() });
    socket.data.messageHistory = timestamps;
    if (timestamps.length > 6) return true;
    if (repeats.length >= 2) return true;
    return false;
  }

  function roomCommand(socket, payload) {
    const room = roomOfSocket(socket);
    if (!room) return;
    const identity = identityFromSocket(socket);
    if (room.ownerId !== identity.id && !socket.data.user?.isAdmin) return;
    const command = String(payload.command || '').trim();
    switch (command) {
      case 'start':
        beginGame(room);
        break;
      case 'lock':
        room.locked = true;
        syncRoom(room);
        break;
      case 'unlock':
        room.locked = false;
        syncRoom(room);
        break;
      case 'setSetting': {
        const { key, value } = payload;
        if (key in room.settings) room.settings[key] = value;
        syncRoom(room);
        break;
      }
      case 'forceDay':
        enterDay(room, 'Host forced a new day.');
        break;
      case 'forceVote':
        enterVote(room);
        break;
      case 'forceNight':
        enterNight(room);
        break;
      case 'kick': {
        const target = room.players.get(payload.targetId);
        if (target) {
          room.players.delete(target.id);
          room.spectators.delete(target.id);
          addLog(room, `${target.name} was removed from the room.`);
          syncRoom(room);
        }
        break;
      }
      default:
        break;
    }
  }

  function leaveRoom(socket) {
    const room = roomOfSocket(socket);
    if (!room) return;
    const identity = identityFromSocket(socket);
    const player = room.players.get(identity.id) || room.spectators.get(identity.id);
    if (!player) return;
    room.players.delete(identity.id);
    room.spectators.delete(identity.id);
    socket.leave(room.code);
    socket.leave(identity.id);
    delete socket.data.roomCode;
    delete socket.data.identityId;
    delete socket.data.personalRoom;
    addLog(room, `${player.name} left the room.`);
    if (room.ownerId === identity.id) {
      const nextHost = room.players.values().next().value || room.spectators.values().next().value;
      if (nextHost) room.ownerId = nextHost.id;
    }
    syncRoom(room);
    if (room.players.size === 0 && room.spectators.size === 0) {
      if (room.timers.phase) clearTimeout(room.timers.phase);
      rooms.delete(room.code);
    }
  }

  function joinRoom(socket, code) {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) throw new Error('Room not found.');
    const identity = identityFromSocket(socket);
    if (room.locked && room.ownerId !== identity.id) throw new Error('Room is locked.');
    let player = room.players.get(identity.id);
    if (!player && room.started) {
      if (!room.settings.allowSpectators) throw new Error('Game already started.');
      player = makePlayer(identity, socket);
      player.spectator = true;
      player.alive = false;
      room.spectators.set(identity.id, player);
      addLog(room, `${player.name} joined as a spectator.`);
    } else if (!player) {
      if (nonSpectatorPlayers(room).length >= room.settings.maxPlayers) throw new Error('Room is full.');
      player = makePlayer(identity, socket);
      room.players.set(identity.id, player);
      addLog(room, `${player.name} joined the room.`);
    } else {
      player.connected = true;
      player.socketId = socket.id;
    }
    socket.join(room.code);
    socket.join(identity.id);
    socket.data.roomCode = room.code;
    socket.data.identityId = identity.id;
    socket.data.personalRoom = identity.id;
    sockets.set(socket.id, socket);
    syncRoom(room);
    autoStartIfFull(room);
    return publicRoom(room);
  }

  function quickPlay(socket, payload = {}) {
    const mode = payload.mode === 'ranked' ? 'ranked' : 'casual';
    const openRoom = [...rooms.values()].find(room => room.mode === mode && !room.started && !room.locked && nonSpectatorPlayers(room).length < room.settings.maxPlayers);
    if (openRoom) {
      joinExistingRoom(socket, openRoom);
      autoStartIfFull(openRoom);
      return publicRoom(openRoom);
    }
    const room = createRoom(socket, { ...payload, mode });
    autoStartIfFull(rooms.get(room.code));
    return room;
  }

  function joinExistingRoom(socket, room) {
    const identity = identityFromSocket(socket);
    let player = room.players.get(identity.id);
    if (!player) {
      player = makePlayer(identity, socket);
      room.players.set(identity.id, player);
    } else {
      player.socketId = socket.id;
      player.connected = true;
    }
    socket.join(room.code);
    socket.join(identity.id);
    socket.data.roomCode = room.code;
    socket.data.identityId = identity.id;
    socket.data.personalRoom = identity.id;
    sockets.set(socket.id, socket);
    syncRoom(room);
  }

  function detachSocket(socket) {
    sockets.delete(socket.id);
    const room = roomOfSocket(socket);
    if (!room) return;
    const identity = identityFromSocket(socket);
    const player = room.players.get(identity.id) || room.spectators.get(identity.id);
    if (player) {
      player.connected = false;
      player.socketId = socket.id;
    }
  }

  function attachSocket(socket) {
    sockets.set(socket.id, socket);
    socket.data.lastActivity = now();
    const identity = identityForSocket(socket);
    socket.join(identity.id);
    socket.data.identityId = identity.id;
    socket.data.personalRoom = identity.id;
    const room = [...rooms.values()].find(r => r.players.has(identity.id) || r.spectators.has(identity.id));
    if (room) {
      const player = room.players.get(identity.id) || room.spectators.get(identity.id);
      if (player) {
        player.socketId = socket.id;
        player.connected = true;
        player.lastActive = now();
        socket.data.roomCode = room.code;
        socket.join(room.code);
        syncRoom(room);
      }
    }
  }

  function sweepInactivePlayers() {
    const threshold = now() - INACTIVE_MS;
    for (const room of rooms.values()) {
      let changed = false;
      for (const player of [...room.players.values(), ...room.spectators.values()]) {
        const socket = player.socketId ? sockets.get(player.socketId) : null;
        const socketIdle = socket ? (socket.data.lastActivity || 0) : 0;
        const playerIdle = player.lastActive || 0;
        const lastSeen = Math.max(socketIdle, playerIdle);
        if (lastSeen >= threshold) continue;

        if (socket && socket.connected) {
          try {
            socket.emit('systemNotice', { text: 'Disconnected for inactivity.' });
            socket.disconnect(true);
          } catch (error) {
            // ignore
          }
        }

        room.players.delete(player.id);
        room.spectators.delete(player.id);
        changed = true;
        addLog(room, `${player.name} was removed for inactivity.`);
      }

      if (changed) {
        if (room.ownerId && !room.players.has(room.ownerId) && !room.spectators.has(room.ownerId)) {
          const nextHost = room.players.values().next().value || room.spectators.values().next().value;
          if (nextHost) room.ownerId = nextHost.id;
        }
        syncRoom(room);
      }

      if (room.players.size === 0 && room.spectators.size === 0) {
        if (room.timers.phase) clearTimeout(room.timers.phase);
        rooms.delete(room.code);
      }
    }
  }

  setInterval(sweepInactivePlayers, SWEEP_MS).unref();

  function summarizeRoom(room) {
    return buildStateFor(room, room.ownerId);
  }

  function setHost(room, targetId) {
    if (room.players.has(targetId) || room.spectators.has(targetId)) room.ownerId = targetId;
  }

  const sockets = new Map();

  return {
    attachSocket,
    detachSocket,
    markActivity,
    createRoom,
    joinRoom,
    quickPlay,
    setReady,
    submitAction,
    castVote,
    sendChat,
    roomCommand,
    leaveRoom,
    listPublicRooms,
    getRoleCatalog: getRoleCatalogCached,
    summarizeRoom,
    setHost
  };
}

module.exports = { createGameManager };
