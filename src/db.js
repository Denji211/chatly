const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const db = {
  users: new Map(),
  usersByUsername: new Map(),
  usersByEmail: new Map(),
  conversations: new Map(),
  messages: new Map(),
  friendships: new Map(),
  friendRequests: new Map(),
  onlineUsers: new Map(),
  typingUsers: new Map(),

  createUser({ username, email, password, displayName }) {
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = {
      id, username: username.toLowerCase(),
      email: email.toLowerCase(),
      displayName, passwordHash,
      avatar: null, bio: '',
      createdAt: Date.now(), lastSeen: Date.now(),
    };
    this.users.set(id, user);
    this.usersByUsername.set(username.toLowerCase(), id);
    this.usersByEmail.set(email.toLowerCase(), id);
    this.friendships.set(id, new Set());
    this.friendRequests.set(id, new Set());
    return this.sanitizeUser(user);
  },

  getUserById(id) {
    const u = this.users.get(id);
    return u ? this.sanitizeUser(u) : null;
  },

  getUserByUsername(username) {
    const id = this.usersByUsername.get(username.toLowerCase());
    return id ? this.sanitizeUser(this.users.get(id)) : null;
  },

  getUserByEmail(email) {
    const id = this.usersByEmail.get(email.toLowerCase());
    return id ? this.users.get(id) : null;
  },

  updateUser(id, updates) {
    const user = this.users.get(id);
    if (!user) return null;
    ['displayName', 'avatar', 'bio'].forEach(k => {
      if (updates[k] !== undefined) user[k] = updates[k];
    });
    if (updates.username && updates.username.toLowerCase() !== user.username) {
      this.usersByUsername.delete(user.username);
      user.username = updates.username.toLowerCase();
      this.usersByUsername.set(user.username, id);
    }
    user.lastSeen = Date.now();
    return this.sanitizeUser(user);
  },

  searchUsers(query, excludeId) {
    const q = query.toLowerCase();
    const results = [];
    for (const [id, user] of this.users) {
      if (id === excludeId) continue;
      if (user.username.includes(q) || user.displayName.toLowerCase().includes(q)) {
        results.push(this.sanitizeUser(user));
      }
      if (results.length >= 20) break;
    }
    return results;
  },

  sanitizeUser(u) {
    const { passwordHash, ...safe } = u;
    return { ...safe, isOnline: this.onlineUsers.has(u.id) };
  },

  // ── Friends ────────────────────────────────────────────────
  sendFriendRequest(fromId, toId) {
    if (!this.friendRequests.has(toId)) this.friendRequests.set(toId, new Set());
    this.friendRequests.get(toId).add(fromId);
  },

  acceptFriendRequest(userId, fromId) {
    const reqs = this.friendRequests.get(userId);
    if (!reqs || !reqs.has(fromId)) return false;
    reqs.delete(fromId);
    this.friendships.get(userId).add(fromId);
    if (!this.friendships.has(fromId)) this.friendships.set(fromId, new Set());
    this.friendships.get(fromId).add(userId);
    return true;
  },

  removeFriend(userId, friendId) {
    this.friendships.get(userId)?.delete(friendId);
    this.friendships.get(friendId)?.delete(userId);
  },

  getFriends(userId) {
    const ids = this.friendships.get(userId) || new Set();
    return [...ids].map(id => this.getUserById(id)).filter(Boolean);
  },

  getPendingRequests(userId) {
    const ids = this.friendRequests.get(userId) || new Set();
    return [...ids].map(id => this.getUserById(id)).filter(Boolean);
  },

  isFriend(a, b) {
    return this.friendships.get(a)?.has(b) || false;
  },

  // ── Conversations ──────────────────────────────────────────
  getOrCreateConversation(userA, userB) {
    const convId = [userA, userB].sort().join('::');
    if (!this.conversations.has(convId)) {
      this.conversations.set(convId, {
        id: convId,
        participants: [userA, userB],
        createdAt: Date.now(),
        lastMessageAt: null,
        lastMessage: null,
        unreadCount: {},
      });
    }
    return this.conversations.get(convId);
  },

  getConversationsForUser(userId) {
    const convs = [];
    for (const [, conv] of this.conversations) {
      if (!conv.participants.includes(userId)) continue;
      const otherId = conv.participants.find(id => id !== userId);
      const other = this.getUserById(otherId);
      if (!other) continue;
      convs.push({
        ...conv,
        otherUser: other,
        unread: conv.unreadCount[userId] || 0,
      });
    }
    return convs.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  },

  // ── Messages ───────────────────────────────────────────────
  createMessage({ convId, senderId, type, content, duration }) {
    const id = uuidv4();
    const msg = {
      id, convId, senderId, type,
      content: content || null,
      duration: duration || null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      reactions: {},
      read: false,
      deleted: false,
    };
    this.messages.set(id, msg);
    const conv = this.conversations.get(convId);
    if (conv) {
      conv.lastMessageAt = Date.now();
      conv.lastMessage = {
        type,
        content: type === 'text' ? content : '🎙️ Message vocal',
        senderId,
      };
      conv.participants.filter(p => p !== senderId).forEach(p => {
        conv.unreadCount[p] = (conv.unreadCount[p] || 0) + 1;
      });
    }
    return msg;
  },

  getMessages(convId, limit = 60) {
    const now = Date.now();
    const msgs = [];
    for (const [, msg] of this.messages) {
      if (msg.convId === convId && !msg.deleted && msg.expiresAt > now) {
        msgs.push(msg);
      }
    }
    return msgs.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
  },

  addReaction(msgId, userId, emoji) {
    const msg = this.messages.get(msgId);
    if (!msg) return null;
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const idx = msg.reactions[emoji].indexOf(userId);
    if (idx >= 0) msg.reactions[emoji].splice(idx, 1);
    else msg.reactions[emoji].push(userId);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    return msg;
  },

  deleteMessage(msgId, userId) {
    const msg = this.messages.get(msgId);
    if (!msg || msg.senderId !== userId) return false;
    msg.deleted = true;
    return true;
  },

  markRead(convId, userId) {
    const conv = this.conversations.get(convId);
    if (conv) conv.unreadCount[userId] = 0;
  },

  purgeExpired() {
    const now = Date.now();
    let n = 0;
    for (const [id, msg] of this.messages) {
      if (msg.expiresAt <= now) { this.messages.delete(id); n++; }
    }
    if (n > 0) console.log(`🗑 ${n} messages expirés supprimés`);
  },

  seed() {
    if (this.users.size > 0) return;
    const alice = this.createUser({ username: 'alice', email: 'alice@chatly.app', password: 'demo1234', displayName: 'Alice ✨' });
    const bob   = this.createUser({ username: 'bob',   email: 'bob@chatly.app',   password: 'demo1234', displayName: 'Bob 🎸' });
    const maya  = this.createUser({ username: 'maya',  email: 'maya@chatly.app',  password: 'demo1234', displayName: 'Maya 🌸' });

    this.sendFriendRequest(alice.id, bob.id);
    this.acceptFriendRequest(bob.id, alice.id);
    this.sendFriendRequest(alice.id, maya.id);
    this.acceptFriendRequest(maya.id, alice.id);

    const c1 = this.getOrCreateConversation(alice.id, bob.id);
    this.createMessage({ convId: c1.id, senderId: bob.id,   type: 'text', content: 'Yo ! T\'es là ? 👋' });
    this.createMessage({ convId: c1.id, senderId: alice.id, type: 'text', content: 'Ouais, que se passe-t-il ?' });
    this.createMessage({ convId: c1.id, senderId: bob.id,   type: 'text', content: 'T\'as vu le match hier ? Incroyable 🔥' });

    const c2 = this.getOrCreateConversation(alice.id, maya.id);
    this.createMessage({ convId: c2.id, senderId: maya.id,  type: 'text', content: 'Coucou ! On fait quoi ce soir ?' });

    console.log('✅ Demo data seeded — login: alice / demo1234');
  },
};

setInterval(() => db.purgeExpired(), 60 * 1000);
db.seed();

module.exports = db;
