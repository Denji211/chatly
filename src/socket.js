const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'chatly_super_secret_2025_change_in_prod';

module.exports = (io, db) => {
  // Auth middleware for Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`🔌 ${socket.user.username} connected [${socket.id}]`);

    // Mark online
    db.onlineUsers.set(userId, socket.id);
    db.updateUser(userId, {});
    socket.broadcast.emit('user:online', { userId });

    // Join personal room
    socket.join(`user:${userId}`);

    // ── Conversations ──────────────────────────────────────
    socket.on('conv:join', ({ convId }) => {
      const conv = db.conversations.get(convId);
      if (conv?.participants.includes(userId)) {
        socket.join(`conv:${convId}`);
        db.markRead(convId, userId);
      }
    });

    socket.on('conv:leave', ({ convId }) => {
      socket.leave(`conv:${convId}`);
    });

    // ── Messages ───────────────────────────────────────────
    socket.on('message:send', ({ convId, type, content, duration, tempId }, ack) => {
      const conv = db.conversations.get(convId);
      if (!conv?.participants.includes(userId)) {
        return ack?.({ error: 'Accès refusé' });
      }

      const msg = db.createMessage({ convId, senderId: userId, type, content, duration });
      const serialized = {
        ...msg,
        reactions: Object.fromEntries(
          Object.entries(msg.reactions).map(([k, v]) => [k, v instanceof Set ? [...v] : v])
        )
      };

      // Send to all in conversation room (including sender)
      io.to(`conv:${convId}`).emit('message:new', { message: serialized, tempId });

      // Notify other participants who aren't in the room
      conv.participants.filter(p => p !== userId).forEach(p => {
        const otherSocket = db.onlineUsers.get(p);
        if (otherSocket) {
          io.to(`user:${p}`).emit('notification:message', {
            convId,
            senderId: userId,
            senderName: db.getUserById(userId)?.displayName,
            senderAvatar: db.getUserById(userId)?.avatar,
            preview: type === 'text' ? content?.slice(0, 80) : '🎙️ Message vocal',
            messageId: msg.id
          });
        }
      });

      // Update conv list for all participants
      conv.participants.forEach(p => {
        io.to(`user:${p}`).emit('conv:updated', {
          convId,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          unread: conv.unreadCount[p] || 0
        });
      });

      ack?.({ message: serialized });
    });

    // ── Reactions ──────────────────────────────────────────
    socket.on('message:react', ({ msgId, convId, emoji }) => {
      const msg = db.addReaction(msgId, userId, emoji);
      if (msg) {
        const serialized = {
          ...msg,
          reactions: Object.fromEntries(
            Object.entries(msg.reactions).map(([k, v]) => [k, v instanceof Set ? [...v] : v])
          )
        };
        io.to(`conv:${convId}`).emit('message:reaction', { msgId, reactions: serialized.reactions, userId, emoji });
      }
    });

    // ── Delete message ─────────────────────────────────────
    socket.on('message:delete', ({ msgId, convId }) => {
      const ok = db.deleteMessage(msgId, userId);
      if (ok) {
        io.to(`conv:${convId}`).emit('message:deleted', { msgId });
      }
    });

    // ── Typing ─────────────────────────────────────────────
    socket.on('typing:start', ({ convId }) => {
      if (!db.typingUsers.has(convId)) db.typingUsers.set(convId, new Set());
      db.typingUsers.get(convId).add(userId);
      socket.to(`conv:${convId}`).emit('typing:update', {
        convId, userId,
        displayName: db.getUserById(userId)?.displayName,
        typing: true
      });
    });

    socket.on('typing:stop', ({ convId }) => {
      db.typingUsers.get(convId)?.delete(userId);
      socket.to(`conv:${convId}`).emit('typing:update', { convId, userId, typing: false });
    });

    // ── Read receipts ──────────────────────────────────────
    socket.on('conv:read', ({ convId }) => {
      db.markRead(convId, userId);
      const conv = db.conversations.get(convId);
      if (conv) {
        socket.to(`conv:${convId}`).emit('conv:read', { convId, userId });
      }
    });

    // ── WebRTC Signaling ───────────────────────────────────
    socket.on('call:invite', ({ targetId, type, callId }) => {
      const caller = db.getUserById(userId);
      io.to(`user:${targetId}`).emit('call:incoming', {
        callId, callerId: userId, type,
        callerName: caller?.displayName,
        callerAvatar: caller?.avatar
      });
    });

    socket.on('call:accept', ({ callId, callerId }) => {
      io.to(`user:${callerId}`).emit('call:accepted', { callId });
      // Join a shared room for WebRTC
      socket.join(`call:${callId}`);
      io.to(`user:${callerId}`).emit('call:join', { callId });
    });

    socket.on('call:decline', ({ callId, callerId }) => {
      io.to(`user:${callerId}`).emit('call:declined', { callId });
    });

    socket.on('call:end', ({ callId, targetId }) => {
      io.to(`user:${targetId}`).emit('call:ended', { callId });
      io.to(`call:${callId}`).emit('call:ended', { callId });
    });

    // WebRTC SDP/ICE
    socket.on('webrtc:offer', ({ callId, targetId, offer }) => {
      io.to(`user:${targetId}`).emit('webrtc:offer', { callId, offer, fromId: userId });
    });

    socket.on('webrtc:answer', ({ callId, targetId, answer }) => {
      io.to(`user:${targetId}`).emit('webrtc:answer', { callId, answer });
    });

    socket.on('webrtc:ice', ({ callId, targetId, candidate }) => {
      io.to(`user:${targetId}`).emit('webrtc:ice', { callId, candidate });
    });

    // ── Disconnect ─────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`❌ ${socket.user.username} disconnected`);
      db.onlineUsers.delete(userId);
      db.users.get(userId) && (db.users.get(userId).lastSeen = Date.now());
      socket.broadcast.emit('user:offline', { userId, lastSeen: Date.now() });
      // Stop all typing
      for (const [convId, set] of db.typingUsers) {
        if (set.has(userId)) {
          set.delete(userId);
          socket.to(`conv:${convId}`).emit('typing:update', { convId, userId, typing: false });
        }
      }
    });
  });
};
