const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createStorage } = require('./server/storage');
const { createGameManager } = require('./server/gameManager');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

const storage = createStorage(path.join(__dirname, 'data'));
const gameManager = createGameManager({ storage });

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, game: 'Nebula Social Deduction' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const result = await storage.register(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await storage.login(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/profile/:userId', async (req, res) => {
  const profile = await storage.getProfile(req.params.userId);
  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  res.json(profile);
});

app.get('/api/friends/:userId', async (req, res) => {
  res.json(await storage.getFriends(req.params.userId));
});

app.post('/api/friends/:userId/request', async (req, res) => {
  try {
    const result = await storage.sendFriendRequest(req.params.userId, req.body.friendId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/friends/:userId/accept', async (req, res) => {
  try {
    const result = await storage.acceptFriendRequest(req.params.userId, req.body.friendId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/roles', (req, res) => {
  res.json(gameManager.getRoleCatalog());
});

app.get('/api/rooms', (req, res) => {
  res.json(gameManager.listPublicRooms());
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const session = storage.getSession(token);
  if (!session) {
    socket.data.guest = true;
    return next();
  }
  socket.data.session = session;
  socket.data.user = storage.getUser(session.userId);
  next();
});

io.on('connection', (socket) => {
  gameManager.attachSocket(socket);
  socket.onAny(() => gameManager.markActivity(socket));
  socket.emit('bootstrap', {
    user: socket.data.user || null,
    sessionToken: socket.handshake.auth && socket.handshake.auth.token || null,
    rooms: gameManager.listPublicRooms(),
    roles: gameManager.getRoleCatalog(),
    achievements: storage.getAchievements()
  });

  socket.on('register', async (payload, ack) => {
    try {
      const result = await storage.register(payload);
      ack && ack({ ok: true, ...result });
    } catch (error) {
      ack && ack({ ok: false, error: error.message });
    }
  });

  socket.on('login', async (payload, ack) => {
    try {
      const result = await storage.login(payload);
      socket.data.session = storage.getSession(result.sessionToken);
      socket.data.user = storage.getUser(result.user.id);
      ack && ack({ ok: true, ...result });
    } catch (error) {
      ack && ack({ ok: false, error: error.message });
    }
  });

  socket.on('createRoom', (payload = {}, ack) => {
    try {
      const room = gameManager.createRoom(socket, payload);
      ack && ack({ ok: true, room });
    } catch (error) {
      ack && ack({ ok: false, error: error.message });
    }
  });

  socket.on('joinRoom', (payload = {}, ack) => {
    try {
      const room = gameManager.joinRoom(socket, payload.code);
      ack && ack({ ok: true, room });
    } catch (error) {
      ack && ack({ ok: false, error: error.message });
    }
  });

  socket.on('quickPlay', (payload = {}, ack) => {
    try {
      const room = gameManager.quickPlay(socket, payload);
      ack && ack({ ok: true, room });
    } catch (error) {
      ack && ack({ ok: false, error: error.message });
    }
  });

  socket.on('setReady', (payload = {}) => gameManager.setReady(socket, payload.ready !== false));
  socket.on('submitAction', (payload = {}) => gameManager.submitAction(socket, payload));
  socket.on('castVote', (payload = {}) => gameManager.castVote(socket, payload));
  socket.on('sendChat', (payload = {}) => gameManager.sendChat(socket, payload));
  socket.on('roomCommand', (payload = {}) => gameManager.roomCommand(socket, payload));
  socket.on('leaveRoom', () => gameManager.leaveRoom(socket));
  socket.on('profileUpdate', (payload = {}) => storage.updateProfile(socket.data.user && socket.data.user.id, payload));
  socket.on('friendRequest', (payload = {}, ack) => {
    storage.sendFriendRequest(socket.data.user && socket.data.user.id, payload.friendId)
      .then(result => ack && ack({ ok: true, ...result }))
      .catch(error => ack && ack({ ok: false, error: error.message }));
  });
  socket.on('friendAccept', (payload = {}, ack) => {
    storage.acceptFriendRequest(socket.data.user && socket.data.user.id, payload.friendId)
      .then(result => ack && ack({ ok: true, ...result }))
      .catch(error => ack && ack({ ok: false, error: error.message }));
  });

  socket.on('disconnect', () => gameManager.detachSocket(socket));
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Nebula Social Deduction running on http://localhost:${port}`);
});
