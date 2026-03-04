const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'chatly_dev_secret_change_in_prod';

module.exports = (io, db) => {
  io.use((socket, next) => {
    try {
      socket.user = jwt.verify(socket.handshake.auth.token, SECRET);
      next();
    } catch {
      next(new Error('Auth invalide'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    db.onlineUsers.set(userId, socket.id);
    socket.join(`user:${userId}`);
    socket.broadcast.emit('user:online', { userId });

    // ── Conversations ────────────────────────────────────────
    socket.on('conv:join', ({ convId }) => {
      const conv = db.conversations.get(convId);
      if (conv?.participants.includes(userId)) {
        socket.join(`conv:${convId}`);
        db.markRead(convId, userId);
      }
    });

    socket.on('conv:read', ({ convId }) => {
      db.markRead(convId, userId);
      socket.to(`conv:${convId}`).emit('conv:read', { convId, userId });
    });

    // ── Messages ─────────────────────────────────────────────
    socket.on('message:send', ({ convId, type, content, duration, tempId }, ack) => {
      const conv = db.conversations.get(convId);
      if (!conv?.participants.includes(userId)) return ack?.({ error: 'Accès refusé' });

      const msg = db.createMessage({ convId, senderId: userId, type, content, duration });

      io.to(`conv:${convId}`).emit('message:new', { message: msg, tempId });

      // Notif pour les participants hors de la room
      conv.participants.filter(p => p !== userId).forEach(p => {
        const sender = db.getUserById(userId);
        io.to(`user:${p}`).emit('notification:message', {
          convId,
          senderId: userId,
          senderName: sender?.displayName,
          senderAvatar: sender?.avatar,
          preview: type === 'text' ? (content?.slice(0, 80) || '') : '🎙️ Message vocal',
        });
        io.to(`user:${p}`).emit('conv:updated', {
          convId,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unread: conv.unreadCount[p] || 0,
        });
      });

      io.to(`user:${userId}`).emit('conv:updated', {
        convId, lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageAt, unread: 0,
      });

      ack?.({ message: msg });
    });

    socket.on('message:react', ({ msgId, convId, emoji }) => {
      const msg = db.addReaction(msgId, userId, emoji);
      if (msg) io.to(`conv:${convId}`).emit('message:reaction', { msgId, reactions: msg.reactions, userId, emoji });
    });

    socket.on('message:delete', ({ msgId, convId }) => {
      if (db.deleteMessage(msgId, userId)) {
        io.to(`conv:${convId}`).emit('message:deleted', { msgId });
      }
    });

    // ── Typing ────────────────────────────────────────────────
    socket.on('typing:start', ({ convId }) => {
      if (!db.typingUsers.has(convId)) db.typingUsers.set(convId, new Set());
      db.typingUsers.get(convId).add(userId);
      socket.to(`conv:${convId}`).emit('typing:update', {
        convId, userId, displayName: db.getUserById(userId)?.displayName, typing: true,
      });
    });

    socket.on('typing:stop', ({ convId }) => {
      db.typingUsers.get(convId)?.delete(userId);
      socket.to(`conv:${convId}`).emit('typing:update', { convId, userId, typing: false });
    });

    // ── Appels WebRTC ─────────────────────────────────────────
    socket.on('call:invite', ({ targetId, type, callId }) => {
      const caller = db.getUserById(userId);
      io.to(`user:${targetId}`).emit('call:incoming', {
        callId, callerId: userId, type,
        callerName: caller?.displayName,
        callerAvatar: caller?.avatar,
      });
    });

    socket.on('call:accept', ({ callId, callerId }) => {
      socket.join(`call:${callId}`);
      io.to(`user:${callerId}`).emit('call:accepted', { callId });
    });

    socket.on('call:decline', ({ callId, callerId }) => {
      io.to(`user:${callerId}`).emit('call:declined', { callId });
    });

    socket.on('call:end', ({ callId, targetId }) => {
      io.to(`user:${targetId}`).emit('call:ended', { callId });
      io.to(`call:${callId}`).emit('call:ended', { callId });
    });

    socket.on('webrtc:offer',  ({ callId, targetId, offer })     => io.to(`user:${targetId}`).emit('webrtc:offer',  { callId, offer, fromId: userId }));
    socket.on('webrtc:answer', ({ callId, targetId, answer })    => io.to(`user:${targetId}`).emit('webrtc:answer', { callId, answer }));
    socket.on('webrtc:ice',    ({ callId, targetId, candidate }) => io.to(`user:${targetId}`).emit('webrtc:ice',    { callId, candidate }));

    // ── Disconnect ────────────────────────────────────────────
    socket.on('disconnect', () => {
      db.onlineUsers.delete(userId);
      const u = db.users.get(userId);
      if (u) u.lastSeen = Date.now();
      socket.broadcast.emit('user:offline', { userId, lastSeen: Date.now() });
      for (const [convId, set] of db.typingUsers) {
        if (set.has(userId)) {
          set.delete(userId);
          socket.to(`conv:${convId}`).emit('typing:update', { convId, userId, typing: false });
        }
      }
    });
  });
};
