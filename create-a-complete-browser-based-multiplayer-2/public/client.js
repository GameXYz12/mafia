(() => {
  const hasSocketIO = typeof window.io === 'function';
  const socket = hasSocketIO
    ? io({ auth: { token: localStorage.getItem('nebula_token') || null } })
    : {
        connected: false,
        auth: {},
        on() {},
        emit() {},
        connect() {},
        disconnect() {}
      };
  const state = {
    user: null,
    rooms: [],
    roles: [],
    roomState: null,
    token: localStorage.getItem('nebula_token') || null,
    authTab: 'login',
    profile: null,
    soundOn: true,
    autoScroll: true,
    modal: null,
    selectedTarget: null,
    selectedSecondaryTarget: null,
    selectedAction: null
  };

  const el = (id) => document.getElementById(id);

  const nodes = {
    app: el('app'),
    authPanel: el('authPanel'),
    authState: el('authState'),
    authForm: el('authForm'),
    authUsername: el('authUsername'),
    authPassword: el('authPassword'),
    authHint: el('authHint'),
    socketState: el('socketState'),
    roomsList: el('roomsList'),
    roleCatalog: el('roleCatalog'),
    roleCount: el('roleCount'),
    roomScreen: el('roomScreen'),
    roomTitle: el('roomTitle'),
    roomPhase: el('roomPhase'),
    roomCodeLabel: el('roomCodeLabel'),
    roomMeta: el('roomMeta'),
    playerList: el('playerList'),
    playerCount: el('playerCount'),
    phaseBanner: el('phaseBanner'),
    dayCounter: el('dayCounter'),
    roleReveal: el('roleReveal'),
    actionPanel: el('actionPanel'),
    chatLog: el('chatLog'),
    gameLog: el('gameLog'),
    modalRoot: el('modalRoot'),
    chatForm: el('chatForm'),
    chatInput: el('chatInput'),
    chatTarget: el('chatTarget'),
    chatChannel: el('chatChannel'),
    roomCodeInput: el('roomCodeInput'),
    roomNameInput: el('roomNameInput'),
    maxPlayersInput: el('maxPlayersInput'),
    dayLengthInput: el('dayLengthInput'),
    nightLengthInput: el('nightLengthInput')
  };

  const SOUND = {
    context: null,
    beep(freq, duration = 0.08, type = 'sine', gain = 0.05) {
      if (!state.soundOn) return;
      if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.context;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      amp.gain.value = gain;
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start();
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.stop(ctx.currentTime + duration);
    },
    phase(name) {
      const preset = {
        day: [440, 660],
        vote: [520, 780],
        night: [240, 120],
        results: [330, 495],
        end: [196, 165]
      };
      const seq = preset[name] || [420];
      seq.forEach((freq, index) => setTimeout(() => this.beep(freq, 0.08, index % 2 ? 'triangle' : 'sine', 0.05), index * 110));
    }
  };

  function badge(label, type = '') {
    return `<span class="badge ${type}">${escapeHtml(label)}</span>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function hashColor(seed) {
    let hash = 0;
    for (const ch of String(seed || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    return `linear-gradient(135deg, hsl(${hue} 90% 66%), hsl(${(hue + 48) % 360} 90% 58%))`;
  }

  function avatar(name, seed) {
    const initials = String(name || '?')
      .split(/\s+/)
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    return `<div class="avatar" style="background:${hashColor(seed)}">${escapeHtml(initials)}</div>`;
  }

  function renderLanding() {
    nodes.app.classList.remove('hidden');
    nodes.roomScreen.classList.add('hidden');
    nodes.roleCount.textContent = `${state.roles.length} roles`;
    nodes.roleCatalog.innerHTML = state.roles.map(role => `
      <article class="role-card">
        <div class="role-top">
          <div>
            <div class="role-name">${escapeHtml(role.name)}</div>
            <div class="role-faction">${escapeHtml(role.faction)} team</div>
          </div>
          ${badge(role.power, role.faction === 'mafia' ? 'danger' : role.faction === 'cult' ? 'warn' : 'good')}
        </div>
        <p class="role-summary">${escapeHtml(role.summary)}</p>
      </article>
    `).join('');
    nodes.roomsList.innerHTML = state.rooms.length ? state.rooms.map(room => `
      <article class="room-item" data-room="${escapeHtml(room.code)}">
        <div class="room-top">
          <strong>${escapeHtml(room.name)}</strong>
          ${badge(room.phase)}
        </div>
        <div class="tiny">${escapeHtml(room.code)} · ${room.playerCount}/${room.settings.maxPlayers} players</div>
        <div class="tiny">Mode: ${escapeHtml(room.mode)} · Day ${room.dayNumber || 0}</div>
      </article>
    `).join('') : `<div class="tiny">No active rooms right now. Create one or queue for quick play.</div>`;
    document.querySelectorAll('[data-room]').forEach(node => {
      node.addEventListener('click', () => joinRoom(node.dataset.room));
    });
    nodes.authState.textContent = state.user ? `Signed in as ${state.user.username}` : 'Guest mode';
    nodes.socketState.textContent = socket.connected ? 'Connected' : 'Disconnected';
  }

  function renderRoom() {
    if (!state.roomState) return;
    nodes.app.classList.add('hidden');
    nodes.roomScreen.classList.remove('hidden');
    const room = state.roomState.room;
    nodes.roomTitle.textContent = room.name;
    nodes.roomPhase.textContent = room.phase.toUpperCase();
    nodes.roomCodeLabel.textContent = room.code;
    nodes.playerCount.textContent = `${state.roomState.players.filter(p => !p.spectator).length}`;
    nodes.dayCounter.textContent = `Day ${room.dayNumber || 0}`;
    nodes.phaseBanner.textContent = phaseBannerText(room.phase, state.roomState.winner);
    nodes.roomMeta.innerHTML = [
      `${badge(room.mode)}`,
      `${badge(room.started ? 'Started' : 'Lobby', room.started ? 'good' : '')}`,
      `${badge(`${room.settings.maxPlayers} max`)}`,
      `${badge(`${room.settings.dayLength}s day`)}`,
      `${badge(`${room.settings.nightLength}s night`)}`
    ].join(' ');
    nodes.playerList.innerHTML = state.roomState.players.map(player => `
      <article class="player-item">
        <div class="player-top">
          <strong>${escapeHtml(player.name)}</strong>
          ${badge(player.alive ? 'Alive' : 'Dead', player.alive ? 'good' : 'danger')}
        </div>
        <div class="player-meta">
          <span>${escapeHtml(player.roleName || 'Hidden')}</span>
          <span>${escapeHtml(player.id)}</span>
        </div>
        <div class="tiny">Faction: ${escapeHtml(room.phase === 'lobby' ? 'hidden' : (player.faction || 'unknown'))} · Vote weight ${player.voteWeight || 1}</div>
      </article>
    `).join('');
    nodes.chatLog.innerHTML = state.roomState.chat.map(renderChatMessage).join('');
    nodes.gameLog.innerHTML = state.roomState.logs.map(renderLogMessage).join('');
    if (state.autoScroll) {
      nodes.chatLog.scrollTop = nodes.chatLog.scrollHeight;
      nodes.gameLog.scrollTop = nodes.gameLog.scrollHeight;
    }
    nodes.roleReveal.classList.toggle('hidden', !state.roomState.viewerRole || state.roomState.room.phase !== 'reveal');
    if (state.roomState.viewerRole && state.roomState.room.phase === 'reveal') {
      const role = state.roles.find(r => r.name === state.roomState.viewerRole) || {};
      nodes.roleReveal.innerHTML = `
        <div class="role-card-big">
          <div class="room-top">
            <div>
              <h2>Your Role: ${escapeHtml(role.name || state.roomState.viewerRole)}</h2>
              <div class="tiny">${escapeHtml(role.faction || '')} team · ${escapeHtml(role.power || '')}</div>
            </div>
            ${badge('Private Reveal', 'good')}
          </div>
          <p class="role-summary">${escapeHtml(role.summary || '')}</p>
        </div>
      `;
    }
    renderActions();
  }

  function phaseBannerText(phase, winner) {
    if (phase === 'end' && winner) return `Game over: ${winner.faction.toUpperCase()} wins. ${winner.reason}`;
    const map = {
      lobby: 'Lobby phase. Ready up, tune settings, and recruit the table.',
      reveal: 'Role assignment phase. Your role card is private.',
      day: 'Day discussion phase. Speak publicly and solve the mystery.',
      vote: 'Voting phase. Cast your accusation or abstain.',
      night: 'Night phase. Submit hidden actions before dawn.',
      results: 'Results phase. Resolve the aftermath.',
      end: 'End game phase.'
    };
    return map[phase] || phase;
  }

  function renderChatMessage(message) {
    return `
      <article class="chat-entry">
        <div class="chat-top">
          <strong>${escapeHtml(message.authorName || 'System')}</strong>
          ${badge(message.channel)}
        </div>
        <div>${escapeHtml(message.text)}</div>
        <div class="chat-meta">
          <span>${escapeHtml(message.authorId || 'system')}</span>
          <span>${new Date(message.at).toLocaleTimeString()}</span>
        </div>
      </article>
    `;
  }

  function renderLogMessage(entry) {
    return `
      <article class="log-entry">
        <div class="log-top">
          <strong>${escapeHtml(entry.kind || 'system')}</strong>
          <span>${new Date(entry.at).toLocaleTimeString()}</span>
        </div>
        <div>${escapeHtml(entry.text)}</div>
      </article>
    `;
  }

  function renderActions() {
    if (!state.roomState) return;
    const { room, viewerRole, players, viewerAlive } = state.roomState;
    const selectableTargets = players.filter(player => player.id !== state.roomState.viewerId);
    const targetButtons = selectableTargets.map(player => `
      <button class="action-btn" data-target="${escapeHtml(player.id)}">
        <div class="room-top">
          <strong>${escapeHtml(player.name)}</strong>
          ${badge(player.alive ? 'alive' : 'dead', player.alive ? 'good' : 'danger')}
        </div>
        <div class="tiny">${escapeHtml(player.roleName || 'hidden')}</div>
      </button>
    `).join('');

    const actions = [];
    if (room.phase === 'lobby') {
      actions.push(`<button class="primary" id="toggleReadyAction">Toggle Ready</button>`);
    } else if (room.phase === 'day') {
      actions.push(`<div class="tiny">Speak in public chat, or use the chat composer to whisper if your role permits it.</div>`);
    } else if (room.phase === 'vote') {
      actions.push(`<button class="secondary" data-vote="abstain">Abstain</button>`);
    } else if (room.phase === 'night' && viewerAlive) {
      actions.push(actionButtonsForRole(viewerRole));
      actions.push(`<div class="tiny">Pick an action, then choose a target from the table below.</div>`);
    } else if (room.phase === 'results') {
      actions.push(`<div class="tiny">Night and voting outcomes are resolving. The next phase will begin automatically.</div>`);
    } else if (room.phase === 'end') {
      actions.push(`<div class="tiny">The match has ended. Check your end-game stats and queue again.</div>`);
    }

    nodes.actionPanel.innerHTML = `
      <div class="stack">
        <div class="action-grid">${actions.join('')}</div>
        <div class="action-grid">${(room.phase === 'vote' || room.phase === 'night') ? targetButtons : ''}</div>
      </div>
    `;

    document.querySelectorAll('[data-target]').forEach(button => {
      button.addEventListener('click', () => {
        const targetId = button.dataset.target;
        if (room.phase === 'vote') {
          socket.emit('castVote', { targetId });
          SOUND.beep(680, 0.06);
        } else if (room.phase === 'night') {
          state.selectedTarget = targetId;
          updateNightActionUI();
        }
      });
    });

    document.querySelectorAll('[data-vote]').forEach(button => {
      button.addEventListener('click', () => {
        socket.emit('castVote', { targetId: button.dataset.vote });
        SOUND.beep(760, 0.06);
      });
    });

    const toggleReady = el('toggleReadyAction');
    if (toggleReady) toggleReady.addEventListener('click', () => socket.emit('setReady', { ready: true }));
  }

  function actionButtonsForRole(roleName) {
    const role = state.roles.find(item => item.name === roleName);
    if (!role) return `<div class="tiny">No action available.</div>`;
    const actionMap = {
      'Mafia': ['kill'],
      'Spy': ['spy'],
      'Beast Man': ['guard'],
      'Hostess': ['block'],
      'Thief': ['steal'],
      'Mad Scientist': ['experiment'],
      'Hitman': ['kill'],
      'Swindler': ['forge'],
      'Mercenary': ['attack', 'guard'],
      'Administrator': ['jam'],
      'Cop': ['investigate_faction'],
      'Doctor': ['protect'],
      'Soldier': ['guard'],
      'Politician': ['broadcast'],
      'Psychic': ['send_spirit'],
      'Lover': ['protect'],
      'Reporter': ['broadcast'],
      'Detective': ['investigate_role'],
      'Ghoul': ['steal'],
      'Martyr': ['attack'],
      'Priest': ['revive'],
      'Gangster': ['intimidate'],
      'Magician': ['swap'],
      'Hacker': ['spy'],
      'Judge': ['pardon', 'condemn'],
      'Prophet': ['vision'],
      'Nurse': ['cleanse'],
      'Mentalist': ['compare'],
      'Cult Leader': ['recruit'],
      'Fanatic': ['protect', 'jam']
    };
    const actions = actionMap[roleName] || [];
    return `
      <div class="action-grid">
        ${actions.map(action => `<button class="action-btn" data-action="${action}"><strong>${escapeHtml(action.replaceAll('_', ' '))}</strong><div class="tiny">${escapeHtml(role.summary)}</div></button>`).join('')}
      </div>
      <div class="tiny">Select a target from the player list and then activate your action.</div>
    `;
  }

  function updateNightActionUI() {
    const buttons = document.querySelectorAll('[data-action]');
    buttons.forEach(button => {
      button.classList.toggle('active', state.selectedAction === button.dataset.action);
      button.onclick = () => {
        state.selectedAction = button.dataset.action;
        state.selectedTarget = null;
        state.selectedSecondaryTarget = null;
        SOUND.beep(520, 0.05);
        renderActions();
      };
    });
    const targetButtons = document.querySelectorAll('[data-target]');
    const requiresSecondTarget = new Set(['swap', 'compare']);
    targetButtons.forEach(button => {
      button.onclick = () => {
        if (!state.selectedAction) return;
        if (requiresSecondTarget.has(state.selectedAction) && !state.selectedTarget) {
          state.selectedTarget = button.dataset.target;
          SOUND.beep(440, 0.04);
          renderActions();
          return;
        }
        if (requiresSecondTarget.has(state.selectedAction) && state.selectedTarget && !state.selectedSecondaryTarget && button.dataset.target !== state.selectedTarget) {
          state.selectedSecondaryTarget = button.dataset.target;
          socket.emit('submitAction', {
            type: state.selectedAction,
            targetId: state.selectedTarget,
            message: nodes.chatInput.value.trim(),
            otherTargetId: state.selectedSecondaryTarget
          });
          SOUND.beep(320, 0.09);
          state.selectedAction = null;
          state.selectedTarget = null;
          state.selectedSecondaryTarget = null;
          renderActions();
          return;
        }
        if (!requiresSecondTarget.has(state.selectedAction)) {
          socket.emit('submitAction', {
            type: state.selectedAction,
            targetId: button.dataset.target,
            message: nodes.chatInput.value.trim(),
            otherTargetId: null
          });
          SOUND.beep(320, 0.09);
          state.selectedAction = null;
          state.selectedTarget = null;
          renderActions();
        }
      };
    });
  }

  function openModal(html) {
    nodes.modalRoot.innerHTML = `<div class="modal slide-up">${html}</div>`;
    nodes.modalRoot.classList.remove('hidden');
  }

  function closeModal() {
    nodes.modalRoot.classList.add('hidden');
    nodes.modalRoot.innerHTML = '';
  }

  function refreshRooms() {
    if (!hasSocketIO) {
      state.rooms = [];
      if (!state.roomState) renderLanding();
      return;
    }
    fetch('/api/rooms').then(res => res.json()).then(data => {
      state.rooms = data;
      if (!state.roomState) renderLanding();
    }).catch(() => {
      state.rooms = [];
      if (!state.roomState) renderLanding();
    });
  }

  function renderProfile(profile) {
    if (!profile) return;
    openModal(`
      <div class="panel-header">
        <h2>Profile</h2>
        <button class="ghost" id="closeProfileModal">Close</button>
      </div>
      <div class="stack">
        <div class="room-top">
          <div>
            <h3>${escapeHtml(profile.username)}</h3>
            <div class="tiny">Level ${profile.level} · XP ${profile.xp}</div>
          </div>
          ${badge(`${profile.stats.winRate || 0}% win rate`, 'good')}
        </div>
        <div class="settings-grid">
          <label>Display Name<input id="profileNameInput" value="${escapeHtml(profile.username)}" /></label>
          <label>Avatar Seed<input id="avatarSeedInput" value="${escapeHtml(profile.avatarSeed || '')}" /></label>
        </div>
        <div class="inline-actions">
          <button class="primary" id="saveProfileBtn">Save Profile</button>
          <button class="secondary" id="friendRequestBtn">Friend Current Table Player</button>
        </div>
        <div>
          <h4>Achievements</h4>
          <div class="stack">
            ${(profile.achievements || []).map(achievement => `<div class="room-item"><strong>${escapeHtml(achievement.title)}</strong><div class="tiny">${escapeHtml(achievement.description)}</div></div>`).join('') || '<div class="tiny">No achievements yet.</div>'}
          </div>
        </div>
        <div>
          <h4>Match History</h4>
          <div class="stack">
            ${(profile.matchHistory || []).slice(-8).reverse().map(match => `<div class="room-item"><strong>${escapeHtml(match.roleName)}</strong><div class="tiny">${escapeHtml(match.outcome)} · ${escapeHtml(match.faction)} · +${match.xpGained} XP</div></div>`).join('') || '<div class="tiny">No matches yet.</div>'}
          </div>
        </div>
      </div>
    `);
    el('closeProfileModal').onclick = closeModal;
    el('saveProfileBtn').onclick = async () => {
      socket.emit('profileUpdate', {
        username: el('profileNameInput').value.trim(),
        avatarSeed: el('avatarSeedInput').value.trim()
      });
      if (state.user) {
        state.user.username = el('profileNameInput').value.trim();
        state.user.avatarSeed = el('avatarSeedInput').value.trim();
      }
      closeModal();
      SOUND.beep(560, 0.08);
    };
    el('friendRequestBtn').onclick = async () => {
      const currentTarget = state.roomState?.players.find(player => player.id !== state.roomState.viewerId && !player.spectator);
      if (!currentTarget) return;
      const response = await fetch(`/api/friends/${state.user.id}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId: currentTarget.id })
      }).then(res => res.json());
      openModal(`<div class="stack"><h3>Friend Request</h3><div class="tiny">${escapeHtml(response.error || 'Request sent.')}</div><button class="primary" id="closeFriendModal">Close</button></div>`);
      el('closeFriendModal').onclick = closeModal;
    };
  }

  function showRoleReveal(role) {
    openModal(`
      <div class="stack">
        <div class="room-top">
          <div>
            <h2>Your Role: ${escapeHtml(role.name)}</h2>
            <div class="tiny">${escapeHtml(role.faction)} team · ${escapeHtml(role.power)}</div>
          </div>
          ${badge('Private Role Reveal', 'good')}
        </div>
        <p class="role-summary">${escapeHtml(role.summary)}</p>
        <div class="inline-actions">
          <button class="primary" id="ackRoleBtn">Enter Match</button>
        </div>
      </div>
    `);
    el('ackRoleBtn').onclick = closeModal;
    SOUND.phase('day');
  }

  function registerHandlers() {
    nodes.authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!hasSocketIO) {
        state.user = {
          id: 'guest_local',
          username: nodes.authUsername.value.trim() || 'Guest Captain',
          avatarSeed: 'local-demo'
        };
        renderLanding();
        return;
      }
      const payload = { username: nodes.authUsername.value.trim(), password: nodes.authPassword.value };
      const endpoint = state.authTab === 'register' ? '/api/auth/register' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(res => res.json());
      if (response.error) {
        openModal(`<div class="stack"><h3>Authentication</h3><div class="tiny">${escapeHtml(response.error)}</div><button class="primary" id="closeAuthError">Close</button></div>`);
        el('closeAuthError').onclick = closeModal;
        return;
      }
      state.user = response.user;
      state.token = response.sessionToken;
      localStorage.setItem('nebula_token', response.sessionToken);
      socket.disconnect();
      socket.auth = { token: state.token };
      socket.connect();
      renderLanding();
    });

    document.querySelectorAll('[data-auth-tab]').forEach(button => {
      button.addEventListener('click', () => {
        state.authTab = button.dataset.authTab;
        document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.classList.toggle('active', tab === button));
        nodes.authHint.textContent = state.authTab === 'register'
          ? 'Register to create a persistent profile with XP, friends, and achievements.'
          : 'Login to restore your profile and reconnect to active rooms.';
      });
    });

    el('quickPlayBtn').addEventListener('click', () => socket.emit('quickPlay', { mode: 'casual' }, onRoomJoined));
    el('matchmakingBtn').addEventListener('click', () => socket.emit('quickPlay', { mode: 'ranked' }, onRoomJoined));
    el('createRoomBtn').addEventListener('click', openCreateRoom);
    el('createRoomSecondaryBtn').addEventListener('click', openCreateRoom);
    el('joinRoomBtn').addEventListener('click', () => joinRoom(nodes.roomCodeInput.value.trim()));
    el('refreshRoomsBtn').addEventListener('click', refreshRooms);
    el('profileToggle').addEventListener('click', async () => {
      if (!state.user) return;
      if (!hasSocketIO) {
        renderProfile({
          username: state.user.username,
          avatarSeed: state.user.avatarSeed,
          level: 1,
          xp: 0,
          stats: { winRate: 0 },
          achievements: [],
          matchHistory: []
        });
        return;
      }
      const profile = await fetch(`/api/profile/${state.user.id}`).then(res => res.json());
      renderProfile(profile);
    });
    el('soundToggle').addEventListener('click', () => {
      state.soundOn = !state.soundOn;
      el('soundToggle').textContent = state.soundOn ? 'Sound On' : 'Sound Off';
    });
    el('copyRoomCode').addEventListener('click', () => navigator.clipboard.writeText(state.roomState?.room.code || ''));
    el('readyBtn').addEventListener('click', () => socket.emit('setReady', { ready: true }));
    el('startBtn').addEventListener('click', () => socket.emit('roomCommand', { command: 'start' }));
    el('leaveBtn').addEventListener('click', leaveRoom);
    el('autoScrollBtn').addEventListener('click', () => { state.autoScroll = !state.autoScroll; });
    nodes.chatForm.addEventListener('submit', sendChat);
    nodes.modalRoot.addEventListener('click', (event) => {
      if (event.target === nodes.modalRoot) closeModal();
    });
  }

  function openCreateRoom() {
    const payload = {
      name: nodes.roomNameInput.value.trim() || 'Nebula Room',
      maxPlayers: Number(nodes.maxPlayersInput.value || 12),
      dayLength: Number(nodes.dayLengthInput.value || 90),
      nightLength: Number(nodes.nightLengthInput.value || 45)
    };
    socket.emit('createRoom', payload, onRoomJoined);
  }

  function joinRoom(code) {
    if (!code) return;
    socket.emit('joinRoom', { code }, onRoomJoined);
  }

  function onRoomJoined(response) {
    if (!response || response.ok === false) {
      openModal(`<div class="stack"><h3>Room Error</h3><div class="tiny">${escapeHtml(response?.error || 'Could not join room.')}</div><button class="primary" id="closeRoomError">Close</button></div>`);
      el('closeRoomError').onclick = closeModal;
      return;
    }
    closeModal();
    refreshRooms();
  }

  function leaveRoom() {
    state.roomState = null;
    nodes.roomScreen.classList.add('hidden');
    nodes.app.classList.remove('hidden');
    socket.emit('leaveRoom');
    SOUND.beep(180, 0.06);
  }

  function sendChat(event) {
    event.preventDefault();
    socket.emit('sendChat', {
      channel: nodes.chatChannel.value,
      text: nodes.chatInput.value.trim(),
      targetId: nodes.chatTarget.value.trim()
    });
    nodes.chatInput.value = '';
  }

  function setupSocket() {
    socket.on('connect', () => {
      nodes.socketState.textContent = 'Connected';
      refreshRooms();
    });
    socket.on('disconnect', () => {
      nodes.socketState.textContent = 'Disconnected';
    });
    socket.on('bootstrap', (payload) => {
      state.user = payload.user;
      state.roles = payload.roles || [];
      state.rooms = payload.rooms || [];
      renderLanding();
    });
    socket.on('roomState', (payload) => {
      state.roomState = payload;
      renderRoom();
    });
    socket.on('privateRole', (payload) => {
      const role = payload.role || { name: payload.roleName, faction: '', summary: '', power: '' };
      showRoleReveal(role);
      SOUND.phase('day');
    });
    socket.on('roomLog', () => renderRoom());
    socket.on('chatMessage', () => renderRoom());
    socket.on('privateResult', (payload) => {
      openModal(`
        <div class="stack">
          <div class="room-top">
            <h3>Private Result</h3>
            ${badge(payload.kind || 'result', 'good')}
          </div>
          <div class="tiny">${escapeHtml(payload.result || '')}</div>
          <button class="primary" id="closePrivateResult">Close</button>
        </div>
      `);
      el('closePrivateResult').onclick = closeModal;
    });
    socket.on('actionResult', (payload) => {
      if (payload?.text) {
        nodes.gameLog.insertAdjacentHTML('beforeend', `<article class="log-entry"><div>${escapeHtml(payload.text)}</div></article>`);
      }
    });
    socket.on('gameOver', (payload) => {
      SOUND.phase('end');
      openModal(`
        <div class="stack">
          <div class="room-top">
            <h2>Game Over</h2>
            ${badge(String(payload.winner || 'draw').toUpperCase(), 'warn')}
          </div>
          <p>${escapeHtml(payload.winner || 'draw')} won the match.</p>
          <div class="tiny">Your role: ${escapeHtml(payload.role || '')} · Faction: ${escapeHtml(payload.faction || '')}</div>
          <button class="primary" id="closeGameOver">Back to lobby</button>
        </div>
      `);
      el('closeGameOver').onclick = closeModal;
      refreshRooms();
    });
    socket.on('chatError', (payload) => {
      openModal(`<div class="stack"><h3>Chat</h3><div class="tiny">${escapeHtml(payload.error || 'Message blocked.')}</div><button class="primary" id="closeChatError">Close</button></div>`);
      el('closeChatError').onclick = closeModal;
    });
  }

  function boot() {
    registerHandlers();
    setupSocket();
    refreshRooms();
    if (state.token) socket.connect();
    renderLanding();
  }

  boot();
})();
