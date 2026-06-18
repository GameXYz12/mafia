const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function makeAvatarSeed(name) {
  return crypto.createHash('sha1').update(name).digest('hex').slice(0, 12);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  const next = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'));
}

function defaultAchievements() {
  return [
    { id: 'ach_1', key: 'first_blood', title: 'First Blood', description: 'Win your first match.', xpReward: 100 },
    { id: 'ach_2', key: 'night_shift', title: 'Night Shift', description: 'Resolve 10 night actions.', xpReward: 120 },
    { id: 'ach_3', key: 'table_voice', title: 'Table Voice', description: 'Send 25 chat messages.', xpReward: 80 },
    { id: 'ach_4', key: 'rising_star', title: 'Rising Star', description: 'Reach level 5.', xpReward: 180 }
  ];
}

function createStorage(baseDir) {
  const filePath = path.join(baseDir, 'storage.json');
  fs.mkdirSync(baseDir, { recursive: true });

  const state = {
    users: [],
    sessions: [],
    friendships: [],
    matchHistory: [],
    achievements: defaultAchievements()
  };

  const load = () => {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      Object.assign(state, {
        users: parsed.users || [],
        sessions: parsed.sessions || [],
        friendships: parsed.friendships || [],
        matchHistory: parsed.matchHistory || [],
        achievements: parsed.achievements || defaultAchievements()
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
    }
  };

  const save = async () => {
    const payload = JSON.stringify(state, null, 2);
    await fsp.writeFile(filePath, payload, 'utf8');
  };

  const sanitizeUser = (user) => {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return { ...safe };
  };

  const upsertUser = (user) => {
    const index = state.users.findIndex(item => item.id === user.id);
    if (index >= 0) state.users[index] = { ...state.users[index], ...user };
    else state.users.push({ ...user });
  };

  const createSession = (userId) => {
    const token = crypto.randomBytes(24).toString('hex');
    state.sessions = state.sessions.filter(session => session.userId !== userId);
    state.sessions.push({ token, userId, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() });
    return token;
  };

  const ensureAchievements = () => {
    if (!state.achievements?.length) state.achievements = defaultAchievements();
  };

  load();

  return {
    async register({ username, password }) {
      ensureAchievements();
      const cleanName = String(username || '').trim();
      if (cleanName.length < 3) throw new Error('Username must be at least 3 characters.');
      if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');
      if (state.users.some(user => user.username.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error('Username already exists.');
      }
      const user = {
        id: uid('user'),
        username: cleanName,
        passwordHash: hashPassword(password),
        avatarSeed: makeAvatarSeed(cleanName),
        level: 1,
        xp: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        matchesPlayed: 0,
        achievements: [],
        favoriteRoles: [],
        dailyMissions: [],
        weeklyMissions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.users.push(user);
      const sessionToken = createSession(user.id);
      await save();
      return { user: sanitizeUser(user), sessionToken };
    },

    async login({ username, password }) {
      const cleanName = String(username || '').trim();
      const user = state.users.find(item => item.username.toLowerCase() === cleanName.toLowerCase());
      if (!user) throw new Error('Invalid username or password.');
      if (!verifyPassword(password, user.passwordHash)) throw new Error('Invalid username or password.');
      const sessionToken = createSession(user.id);
      user.updatedAt = new Date().toISOString();
      await save();
      return { user: sanitizeUser(user), sessionToken };
    },

    getSession(token) {
      if (!token) return null;
      const session = state.sessions.find(item => item.token === token);
      if (!session) return null;
      session.lastSeen = new Date().toISOString();
      return { ...session };
    },

    getUser(userId) {
      return sanitizeUser(state.users.find(user => user.id === userId));
    },

    async getProfile(userId) {
      const user = state.users.find(item => item.id === userId);
      if (!user) return null;
      const friends = state.friendships.filter(item => item.status === 'accepted' && (item.requesterId === userId || item.addresseeId === userId));
      return {
        ...sanitizeUser(user),
        friends: friends.map(friendship => friendship.requesterId === userId ? friendship.addresseeId : friendship.requesterId),
        matchHistory: state.matchHistory.filter(item => item.userId === userId).slice(-50),
        achievements: (user.achievements || []).map(key => state.achievements.find(item => item.key === key)).filter(Boolean),
        stats: {
          winRate: user.matchesPlayed ? Math.round((user.wins / user.matchesPlayed) * 100) : 0
        }
      };
    },

    async updateProfile(userId, patch = {}) {
      const user = state.users.find(item => item.id === userId);
      if (!user) throw new Error('User not found.');
      if (typeof patch.username === 'string' && patch.username.trim().length >= 3) {
        user.username = patch.username.trim();
      }
      if (typeof patch.avatarSeed === 'string' && patch.avatarSeed.trim()) {
        user.avatarSeed = patch.avatarSeed.trim().slice(0, 24);
      }
      if (Array.isArray(patch.favoriteRoles)) {
        user.favoriteRoles = patch.favoriteRoles.slice(0, 8);
      }
      user.updatedAt = new Date().toISOString();
      await save();
      return sanitizeUser(user);
    },

    async addMatchResult(result) {
      const { userId, roomCode, roleName, faction, outcome, xpGained } = result;
      const user = state.users.find(item => item.id === userId);
      if (!user) return null;
      user.matchesPlayed += 1;
      if (outcome === 'win') user.wins += 1;
      else if (outcome === 'loss') user.losses += 1;
      else user.draws += 1;
      user.xp += Math.max(0, xpGained || 0);
      user.level = 1 + Math.floor(user.xp / 250);
      user.updatedAt = new Date().toISOString();
      state.matchHistory.push({
        id: uid('match'),
        userId,
        roomCode,
        roleName,
        faction,
        outcome,
        xpGained: Math.max(0, xpGained || 0),
        createdAt: new Date().toISOString()
      });
      this.unlockAchievements(user);
      await save();
      return sanitizeUser(user);
    },

    unlockAchievements(user) {
      ensureAchievements();
      const owned = new Set(user.achievements || []);
      const checks = [];
      if (user.wins >= 1) checks.push('first_blood');
      if (user.matchesPlayed >= 10) checks.push('night_shift');
      if ((user.matchesPlayed >= 25) && (user.chatCount || 0) >= 25) checks.push('table_voice');
      if (user.level >= 5) checks.push('rising_star');
      for (const key of checks) {
        if (!owned.has(key)) {
          owned.add(key);
          user.achievements = [...owned];
          const achievement = state.achievements.find(item => item.key === key);
          if (achievement) user.xp += achievement.xpReward;
        }
      }
    },

    async getFriends(userId) {
      const records = state.friendships.filter(item => item.requesterId === userId || item.addresseeId === userId);
      return records.map(item => ({
        ...item,
        user: sanitizeUser(state.users.find(user => user.id === (item.requesterId === userId ? item.addresseeId : item.requesterId)))
      }));
    },

    async sendFriendRequest(userId, friendId) {
      if (!userId) throw new Error('Login required.');
      if (!friendId || friendId === userId) throw new Error('Invalid friend target.');
      const target = state.users.find(user => user.id === friendId);
      if (!target) throw new Error('User not found.');
      const existing = state.friendships.find(item =>
        ((item.requesterId === userId && item.addresseeId === friendId) || (item.requesterId === friendId && item.addresseeId === userId)) &&
        item.status !== 'rejected'
      );
      if (existing) return { friendship: existing };
      const friendship = {
        id: uid('friend'),
        requesterId: userId,
        addresseeId: friendId,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      state.friendships.push(friendship);
      await save();
      return { friendship };
    },

    async acceptFriendRequest(userId, friendId) {
      const request = state.friendships.find(item =>
        item.requesterId === friendId && item.addresseeId === userId && item.status === 'pending'
      );
      if (!request) throw new Error('Friend request not found.');
      request.status = 'accepted';
      await save();
      return { friendship: request };
    },

    getAchievements() {
      ensureAchievements();
      return state.achievements.map(item => ({ ...item }));
    },

    async recordChat(userId) {
      const user = state.users.find(item => item.id === userId);
      if (!user) return;
      user.chatCount = (user.chatCount || 0) + 1;
      if (user.chatCount % 10 === 0) this.unlockAchievements(user);
      await save();
    },

    async flush() {
      await save();
    }
  };
}

module.exports = { createStorage };
