// ═══════════════════════════════════════════════════════════
// CHATLY — Frontend Application
// ═══════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
const S = {
  token: localStorage.getItem('chatly_token'),
  user: JSON.parse(localStorage.getItem('chatly_user') || 'null'),
  conversations: [],
  currentConvId: null,
  messages: {},
  typingTimers: {},
  isTyping: false,
  typingTimer: null,
  emojiOpen: false,
  profilePanelOpen: false,
  recording: false,
  recInterval: null,
  recSeconds: 0,
  socket: null,
  call: null,
  callTimer: null,
  callStream: null,
  activePanel: 'messages', // messages | search | settings
};

const BASE = window.location.origin;

// ── API Helper ────────────────────────────────────────────────
const api = {
  async req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (S.token) headers['Authorization'] = `Bearer ${S.token}`;
    const r = await fetch(`${BASE}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  patch: (p, b) => api.req('PATCH', p, b),
  delete: (p) => api.req('DELETE', p),

  async uploadAvatar(file) {
    const fd = new FormData();
    fd.append('avatar', file);
    const r = await fetch(`${BASE}/api/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${S.token}` },
      body: fd
    });
    return r.json();
  }
};

// ── Socket Setup ──────────────────────────────────────────────
function initSocket() {
  S.socket = io({ auth: { token: S.token } });

  S.socket.on('connect', () => console.log('🔌 Socket connected'));
  S.socket.on('connect_error', (e) => console.warn('Socket error:', e.message));

  // Online/offline
  S.socket.on('user:online', ({ userId }) => {
    updateUserOnlineStatus(userId, true);
  });
  S.socket.on('user:offline', ({ userId }) => {
    updateUserOnlineStatus(userId, false);
  });

  // New message
  S.socket.on('message:new', ({ message, tempId }) => {
    // Remove optimistic temp message
    if (tempId && S.messages[message.convId]) {
      S.messages[message.convId] = S.messages[message.convId].filter(m => m.id !== tempId);
    }
    if (!S.messages[message.convId]) S.messages[message.convId] = [];
    S.messages[message.convId].push(message);
    if (S.currentConvId === message.convId) {
      appendMessage(message);
      S.socket.emit('conv:read', { convId: message.convId });
    }
  });

  // Message deleted
  S.socket.on('message:deleted', ({ msgId }) => {
    if (S.currentConvId) {
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) el.closest('.msg-row')?.remove();
    }
  });

  // Reactions
  S.socket.on('message:reaction', ({ msgId, reactions }) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) updateReactionsEl(el, reactions);
  });

  // Typing
  S.socket.on('typing:update', ({ convId, userId, typing, displayName }) => {
    if (convId !== S.currentConvId) return;
    clearTimeout(S.typingTimers[userId]);
    if (typing) {
      showTypingIndicator(displayName);
      S.typingTimers[userId] = setTimeout(() => hideTypingIndicator(), 4000);
    } else {
      hideTypingIndicator();
    }
  });

  // Conv updated
  S.socket.on('conv:updated', ({ convId, lastMessage, lastMessageAt, unread }) => {
    const conv = S.conversations.find(c => c.id === convId);
    if (conv) {
      conv.lastMessage = lastMessage;
      conv.lastMessageAt = lastMessageAt;
      conv.unread = unread;
      renderConversationList();
    }
  });

  // Read receipts
  S.socket.on('conv:read', ({ convId, userId }) => {
    if (userId !== S.user.id && convId === S.currentConvId) {
      document.querySelectorAll('.msg-read').forEach(el => el.textContent = '✓✓');
    }
  });

  // Notification
  S.socket.on('notification:message', ({ convId, senderName, senderAvatar, preview }) => {
    if (convId !== S.currentConvId) {
      showToast(senderAvatar || '💬', senderName, preview, () => openConversation(convId));
    }
  });

  // WebRTC & calls
  S.socket.on('call:incoming', (data) => showIncomingCall(data));
  S.socket.on('call:accepted', ({ callId }) => onCallAccepted(callId));
  S.socket.on('call:declined', () => { endCallUI(); showToast('📵', 'Appel refusé', 'L\'autre personne n\'était pas disponible.'); });
  S.socket.on('call:ended', () => endCallUI());
  S.socket.on('webrtc:offer', (data) => handleWebRTCOffer(data));
  S.socket.on('webrtc:answer', (data) => handleWebRTCAnswer(data));
  S.socket.on('webrtc:ice', (data) => handleWebRTCIce(data));
}

function updateUserOnlineStatus(userId, online) {
  // Update in conversation list
  S.conversations.forEach(c => {
    if (c.otherUser?.id === userId) c.otherUser.isOnline = online;
  });
  // Update header if current chat
  const statusEl = document.querySelector('.chat-header-status');
  if (statusEl && S.currentConvId) {
    const conv = S.conversations.find(c => c.id === S.currentConvId);
    if (conv?.otherUser?.id === userId) {
      statusEl.textContent = online ? '● En ligne' : '● Hors ligne';
      statusEl.className = 'chat-header-status' + (online ? '' : ' offline');
    }
  }
  renderConversationList();
}

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  if (S.token && S.user) {
    try {
      const { user } = await api.get('/api/auth/me');
      S.user = user;
      localStorage.setItem('chatly_user', JSON.stringify(user));
      launchApp();
    } catch {
      logout(false);
      showLanding();
    }
  } else {
    showLanding();
  }
}

function launchApp() {
  initSocket();
  renderApp();
  loadConversations();
}

// ── RENDER APP SHELL ─────────────────────────────────────────
function renderApp() {
  document.getElementById('app').innerHTML = `
    <div id="mainApp" style="display:flex;width:100%;height:100vh;overflow:hidden;">
      ${renderSidebar()}
      <div id="panel" style="width:var(--panel-w);background:var(--s1);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;"></div>
      <main id="content" style="flex:1;display:flex;flex-direction:column;min-width:0;position:relative;"></main>
    </div>
  `;
  renderPanel('messages');
  renderEmptyState();
}

function renderSidebar() {
  const u = S.user;
  const avatarContent = u.avatar
    ? `<img src="${u.avatar}" alt="">`
    : getInitials(u.displayName);
  const avatarBg = u.avatar ? '' : `style="background:${getUserGradient(u.id)}"`;

  return `
  <aside id="sidebar" style="width:var(--sidebar-w);background:var(--s1);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:14px 0;flex-shrink:0;z-index:20;">
    <div class="sidebar-logo">C</div>
    <nav class="sidebar-nav">
      <button class="sb-item active" id="sb-messages" onclick="setPanel('messages')" title="">
        <span>💬</span>
        <span class="sb-badge hidden" id="totalUnreadBadge">0</span>
        <span class="sb-tooltip">Messages</span>
      </button>
      <button class="sb-item" id="sb-search" onclick="setPanel('search')" title="">
        <span>🔍</span>
        <span class="sb-tooltip">Rechercher</span>
      </button>
      <button class="sb-item" id="sb-requests" onclick="setPanel('requests')" title="">
        <span>👥</span>
        <span class="sb-badge hidden" id="requestsBadge">0</span>
        <span class="sb-tooltip">Demandes</span>
      </button>
    </nav>
    <button class="sb-avatar" id="sbAvatar" onclick="setPanel('settings')" title="Mon profil" ${avatarBg}>
      ${avatarContent}
    </button>
  </aside>`;
}

// ── PANEL ─────────────────────────────────────────────────────
function setPanel(name) {
  S.activePanel = name;
  document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`sb-${name}`)?.classList.add('active');
  renderPanel(name);
}

function renderPanel(name) {
  const panel = document.getElementById('panel');
  if (name === 'messages') {
    panel.innerHTML = `
      <div class="panel-head">
        <div class="panel-head-row">
          <span class="panel-head-title">Messages</span>
          <button class="sb-item" style="width:32px;height:32px;border-radius:9px;" onclick="setPanel('search')" title="Nouveau message">✏️</button>
        </div>
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" placeholder="Rechercher une conversation..." oninput="filterConvs(this.value)" id="convSearch">
        </div>
      </div>
      <div class="panel-section-label">En ligne</div>
      <div class="stories-row" id="onlineStrip"></div>
      <div class="panel-section-label">Conversations</div>
      <div class="panel-scroll" id="convList"></div>
    `;
    renderConversationList();
    renderOnlineStrip();
  } else if (name === 'search') {
    panel.innerHTML = `
      <div class="panel-head">
        <div class="panel-head-row">
          <span class="panel-head-title">Rechercher</span>
        </div>
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" placeholder="Pseudo ou nom..." oninput="searchUsers(this.value)" id="userSearch" autofocus>
        </div>
      </div>
      <div class="panel-section-label">Utilisateurs</div>
      <div class="panel-scroll" id="searchResultsList">
        <div style="padding:32px 16px;text-align:center;color:var(--text3);font-size:14px;">Tape un nom ou pseudo pour rechercher</div>
      </div>
    `;
    setTimeout(() => document.getElementById('userSearch')?.focus(), 50);
  } else if (name === 'requests') {
    panel.innerHTML = `
      <div class="panel-head">
        <div class="panel-head-row">
          <span class="panel-head-title">Demandes</span>
        </div>
      </div>
      <div class="panel-section-label">Demandes reçues</div>
      <div class="panel-scroll" id="requestsList"></div>
    `;
    loadFriendRequests();
  } else if (name === 'settings') {
    renderSettings();
  }
}

// ── CONVERSATIONS ─────────────────────────────────────────────
async function loadConversations() {
  try {
    const { conversations } = await api.get('/api/messages/conversations');
    S.conversations = conversations;
    renderConversationList();
    renderOnlineStrip();
    updateTotalUnread();
  } catch (e) { console.warn(e); }
}

function renderConversationList(filter = '') {
  const list = document.getElementById('convList');
  if (!list) return;

  const filtered = S.conversations.filter(c => {
    if (!filter) return true;
    return c.otherUser?.displayName?.toLowerCase().includes(filter.toLowerCase()) ||
           c.otherUser?.username?.toLowerCase().includes(filter.toLowerCase());
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:14px;">${filter ? 'Aucun résultat' : 'Aucune conversation<br><span style="font-size:12px">Cherche un ami pour commencer</span>'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(c => renderConvItem(c)).join('');
}

function renderConvItem(c) {
  const u = c.otherUser;
  if (!u) return '';
  const avatarContent = u.avatar ? `<img class="conv-avatar-img" src="${u.avatar}">` : `<div class="conv-avatar-fallback" style="background:${getUserGradient(u.id)}">${getInitials(u.displayName)}</div>`;
  const lastMsg = c.lastMessage;
  let preview = 'Dites bonjour ! 👋';
  if (lastMsg) {
    if (lastMsg.type === 'voice') preview = '🎙️ Message vocal';
    else if (lastMsg.type === 'text') preview = lastMsg.content?.slice(0, 50) || '';
  }

  const h = c.lastMessageAt ? getHoursLeft(c.lastMessageAt) : 24;
  const timerChip = h <= 4 ? `<div class="conv-timer">⏱ ${h}h</div>` : '';

  return `
  <div class="conv-item ${S.currentConvId === c.id ? 'active' : ''}" onclick="openConversation('${c.id}')" data-conv-id="${c.id}">
    <div class="conv-avatar">
      ${avatarContent}
      ${u.isOnline ? '<div class="online-ring"></div>' : ''}
    </div>
    <div class="conv-info">
      <div class="conv-name">${escHtml(u.displayName)}</div>
      <div class="conv-preview ${c.unread > 0 ? 'unread' : ''}">${escHtml(preview)}</div>
    </div>
    <div class="conv-meta">
      <div class="conv-time">${c.lastMessageAt ? formatTime(c.lastMessageAt) : ''}</div>
      ${c.unread > 0 ? `<div class="conv-unread">${c.unread}</div>` : timerChip}
    </div>
  </div>`;
}

function renderOnlineStrip() {
  const strip = document.getElementById('onlineStrip');
  if (!strip) return;
  const online = S.conversations.filter(c => c.otherUser?.isOnline);
  if (online.length === 0) {
    strip.innerHTML = `<div style="font-size:13px;color:var(--text3);padding:4px 0">Aucun ami en ligne</div>`;
    return;
  }
  strip.innerHTML = online.map(c => {
    const u = c.otherUser;
    const av = u.avatar ? `<img src="${u.avatar}">` : getInitials(u.displayName);
    return `
    <div class="story-item" onclick="openConversation('${c.id}')">
      <div class="story-ring">
        <div class="story-avatar-inner" style="${u.avatar ? '' : `background:${getUserGradient(u.id)};color:white;font-weight:700;font-size:14px;`}">${av}</div>
      </div>
      <div class="story-item-name">${escHtml(u.displayName.split(' ')[0])}</div>
    </div>`;
  }).join('');
}

function filterConvs(val) { renderConversationList(val); }

function updateTotalUnread() {
  const total = S.conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
  const badge = document.getElementById('totalUnreadBadge');
  if (badge) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.toggle('hidden', total === 0);
  }
}

// ── OPEN CONVERSATION ─────────────────────────────────────────
async function openConversation(convId) {
  S.currentConvId = convId;
  const conv = S.conversations.find(c => c.id === convId);
  if (!conv) return;

  conv.unread = 0;
  renderConversationList();
  updateTotalUnread();

  // Close profile panel if open
  S.profilePanelOpen = false;

  const content = document.getElementById('content');
  const u = conv.otherUser;
  const avatarContent = u?.avatar ? `<img src="${u.avatar}">` : `<div style="width:100%;height:100%;background:${getUserGradient(u?.id)};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:white;border-radius:50%">${getInitials(u?.displayName)}</div>`;

  content.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-avatar" onclick="toggleProfilePanel()" style="cursor:pointer">${avatarContent}</div>
      <div class="chat-header-info" onclick="toggleProfilePanel()" style="cursor:pointer">
        <div class="chat-header-name">${escHtml(u?.displayName || '')}</div>
        <div class="chat-header-status ${u?.isOnline ? '' : 'offline'}" id="chatStatus">
          ${u?.isOnline ? '● En ligne' : '● Hors ligne'}
        </div>
      </div>
      <div class="header-actions">
        <button class="ha-btn" onclick="startCall('voice')" title="Appel vocal">📞</button>
        <button class="ha-btn" onclick="startCall('video')" title="Appel vidéo">📹</button>
        <button class="ha-btn" onclick="toggleProfilePanel()" title="Profil">ℹ️</button>
      </div>
    </div>
    <div class="timer-bar" id="timerBar">
      <span class="timer-bar-label">⏱ Messages 24h</span>
      <div class="timer-track"><div class="timer-fill" id="timerFill" style="width:100%;background:var(--green)"></div></div>
      <span class="timer-remaining" id="timerRemaining">24h restantes</span>
    </div>
    <div class="messages-scroll" id="msgsArea" style="flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:2px;"></div>
    <div id="typingArea" style="padding:0 18px 6px;min-height:28px;"></div>
    <div class="input-zone" style="position:relative;">
      <div class="input-row">
        <div class="input-extra">
          <button class="ix-btn" onclick="triggerMedia()" title="Fichier">📎</button>
        </div>
        <div class="msg-box">
          <textarea class="msg-textarea" id="msgInput" placeholder="Écris un message..." rows="1"
            onkeydown="handleMsgKey(event)"
            oninput="handleTypingInput(this)"></textarea>
          <span class="emoji-trigger" onclick="toggleEmojiPicker()">😊</span>
        </div>
        <button class="ix-btn" id="recBtn" title="Maintenir pour enregistrer"
          onmousedown="startRec()" onmouseup="stopRec()"
          ontouchstart="startRec(event)" ontouchend="stopRec()">🎙️</button>
        <button class="send-btn" onclick="sendMsg()">➤</button>
      </div>
      <div id="emojiPickerZone" style="position:absolute;bottom:68px;right:14px;z-index:50;display:none;"></div>
    </div>
  `;

  // Join socket room
  S.socket?.emit('conv:join', { convId });
  S.socket?.emit('conv:read', { convId });

  // Load messages
  try {
    const { messages } = await api.get(`/api/messages/${convId}`);
    S.messages[convId] = messages;
    renderMessages(convId);
  } catch (e) { console.warn(e); }
}

// ── MESSAGES RENDERING ────────────────────────────────────────
function renderMessages(convId) {
  const area = document.getElementById('msgsArea');
  if (!area) return;
  const msgs = S.messages[convId] || [];
  area.innerHTML = '';

  if (msgs.length === 0) {
    area.innerHTML = `<div class="sys-msg">Dites bonjour ! Tous les messages disparaissent après 24h ⏱</div>`;
    return;
  }

  area.innerHTML += `<div class="date-separator">Aujourd'hui</div>`;
  msgs.forEach(m => appendMessage(m, false));
  area.scrollTop = area.scrollHeight;
}

function appendMessage(msg, scroll = true) {
  const area = document.getElementById('msgsArea');
  if (!area || msg.convId !== S.currentConvId) return;

  const emptyEl = area.querySelector('.sys-msg');
  if (emptyEl) emptyEl.remove();

  const el = buildMessageEl(msg);
  area.appendChild(el);
  if (scroll) area.scrollTop = area.scrollHeight;
}

function buildMessageEl(msg) {
  const isMe = msg.senderId === S.user.id;
  const conv = S.conversations.find(c => c.id === msg.convId);
  const other = conv?.otherUser;

  const h = getHoursLeft(msg.expiresAt);
  const timerClass = h <= 1 ? 'expiring' : h <= 4 ? 'urgent' : h <= 8 ? 'mid' : 'fresh';

  const reactionsHtml = buildReactionsHtml(msg.reactions, msg.id, isMe);
  const QUICK_REACTS = ['❤️', '😂', '🔥', '😮', '👍', '😭'];
  const quickReact = `<div class="msg-quick-react">${QUICK_REACTS.map(e => `<span class="qr-emoji" onclick="reactMsg('${msg.id}','${msg.convId}','${e}')">${e}</span>`).join('')}</div>`;

  let bubbleHtml = '';
  if (msg.type === 'voice') {
    bubbleHtml = `
      <div class="voice-msg ${isMe ? 'me' : 'them'} msg-bubble" data-msg-id="${msg.id}" oncontextmenu="showCtxMenu(event,'${msg.id}','${msg.convId}',${isMe})">
        ${quickReact}
        <button class="voice-play" onclick="playVoice(this,'${msg.id}')">▶</button>
        <div class="voice-waveform">${genWaveform()}</div>
        <div class="voice-dur">${msg.duration || '0:00'}</div>
      </div>`;
  } else if (msg.type === 'image') {
    bubbleHtml = `
      <div class="msg-bubble ${isMe ? 'me' : 'them'}" data-msg-id="${msg.id}" oncontextmenu="showCtxMenu(event,'${msg.id}','${msg.convId}',${isMe})" style="padding:4px;">
        ${quickReact}
        <img src="${msg.content}" style="max-width:240px;max-height:240px;border-radius:12px;display:block;cursor:pointer;" onclick="viewImage('${msg.content}')">
      </div>`;
  } else {
    bubbleHtml = `
      <div class="msg-bubble ${isMe ? 'me' : 'them'}" data-msg-id="${msg.id}" oncontextmenu="showCtxMenu(event,'${msg.id}','${msg.convId}',${isMe})">
        ${quickReact}
        ${escHtml(msg.content || '')}
      </div>`;
  }

  const avatarContent = other?.avatar ? `<img src="${other.avatar}">` : `<div style="width:100%;height:100%;background:${getUserGradient(other?.id)};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;border-radius:50%">${getInitials(other?.displayName)}</div>`;

  const row = document.createElement('div');
  row.className = `msg-row ${isMe ? 'me' : ''}`;
  row.dataset.msgId = msg.id;
  row.innerHTML = `
    ${!isMe ? `<div class="msg-row-avatar" style="width:28px;height:28px;border-radius:50%;flex-shrink:0;margin-top:4px;overflow:hidden;">${avatarContent}</div>` : ''}
    <div class="msg-col">
      ${bubbleHtml}
      <div class="msg-meta">
        <span class="msg-ts">${formatTime(msg.createdAt)}</span>
        <span class="msg-timer-chip ${timerClass}">⏱ ${h}h</span>
        ${isMe ? `<span class="msg-read">${msg.read ? '✓✓' : '✓'}</span>` : ''}
      </div>
      ${reactionsHtml ? `<div class="msg-reactions" id="reactions-${msg.id}">${reactionsHtml}</div>` : `<div class="msg-reactions" id="reactions-${msg.id}"></div>`}
    </div>
    ${isMe ? `<div style="width:28px;flex-shrink:0;"></div>` : ''}
  `;
  return row;
}

function buildReactionsHtml(reactions, msgId, isMe) {
  if (!reactions || Object.keys(reactions).length === 0) return '';
  return Object.entries(reactions).map(([emoji, users]) => {
    const count = Array.isArray(users) ? users.length : users;
    if (!count) return '';
    const mine = Array.isArray(users) && users.includes(S.user.id);
    return `<div class="reaction-pill ${mine ? 'mine' : ''}" onclick="reactMsg('${msgId}','${S.currentConvId}','${emoji}')">
      <span>${emoji}</span><span class="reaction-count">${count}</span>
    </div>`;
  }).join('');
}

function updateReactionsEl(msgBubble, reactions) {
  const msgId = msgBubble.dataset.msgId;
  const isMe = msgBubble.closest('.msg-row')?.classList.contains('me');
  const el = document.getElementById(`reactions-${msgId}`);
  if (el) el.innerHTML = buildReactionsHtml(reactions, msgId, isMe);
}

function genWaveform() {
  return Array.from({length: 24}, () => {
    const h = Math.random() * 18 + 4;
    return `<div class="wv-bar" style="height:${h}px"></div>`;
  }).join('');
}

// ── SEND MESSAGE ──────────────────────────────────────────────
function sendMsg() {
  const inp = document.getElementById('msgInput');
  if (!inp) return;
  const content = inp.value.trim();
  if (!content || !S.currentConvId) return;

  const tempId = 'tmp_' + Date.now();
  const optimistic = {
    id: tempId, convId: S.currentConvId,
    senderId: S.user.id, type: 'text', content,
    createdAt: Date.now(), expiresAt: Date.now() + 86400000,
    reactions: {}, read: false
  };
  appendMessage(optimistic);

  S.socket?.emit('message:send', {
    convId: S.currentConvId, type: 'text', content, tempId
  });

  inp.value = '';
  autoResize(inp);
  stopTypingSignal();
  inp.focus();

  // Update conv preview
  const conv = S.conversations.find(c => c.id === S.currentConvId);
  if (conv) {
    conv.lastMessage = { type: 'text', content, senderId: S.user.id };
    conv.lastMessageAt = Date.now();
    renderConversationList();
  }
}

function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function handleTypingInput(el) {
  autoResize(el);
  if (!S.currentConvId) return;
  if (!S.isTyping) {
    S.isTyping = true;
    S.socket?.emit('typing:start', { convId: S.currentConvId });
  }
  clearTimeout(S.typingTimer);
  S.typingTimer = setTimeout(stopTypingSignal, 2500);
}

function stopTypingSignal() {
  if (S.isTyping && S.currentConvId) {
    S.isTyping = false;
    S.socket?.emit('typing:stop', { convId: S.currentConvId });
  }
  clearTimeout(S.typingTimer);
}

function showTypingIndicator(name) {
  const area = document.getElementById('typingArea');
  if (!area) return;
  area.innerHTML = `
    <div class="typing-row">
      <div class="typing-bubble">
        <div class="typing-dots">
          <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div>
      </div>
      <span style="font-size:11px;color:var(--text3);margin-left:6px;align-self:flex-end;">${escHtml(name)} écrit...</span>
    </div>`;
}
function hideTypingIndicator() {
  const area = document.getElementById('typingArea');
  if (area) area.innerHTML = '';
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── REACTIONS ─────────────────────────────────────────────────
function reactMsg(msgId, convId, emoji) {
  S.socket?.emit('message:react', { msgId, convId, emoji });
}

// ── CONTEXT MENU ──────────────────────────────────────────────
function showCtxMenu(e, msgId, convId, isMe) {
  e.preventDefault();
  const menu = document.getElementById('contextMenu');
  menu.classList.remove('ctx-hidden');
  menu.innerHTML = `
    <div class="ctx-item" onclick="copyMsg('${msgId}')">📋 Copier</div>
    <div class="ctx-sep"></div>
    ${['❤️','😂','🔥','😮','👍'].map(em => `<div class="ctx-item" onclick="reactMsg('${msgId}','${convId}','${em}');closeCtx()">${em} Réagir</div>`).join('')}
    ${isMe ? `<div class="ctx-sep"></div><div class="ctx-item danger" onclick="deleteMsg('${msgId}','${convId}');closeCtx()">🗑️ Supprimer</div>` : ''}
  `;
  let x = e.clientX, y = e.clientY;
  if (x + 180 > window.innerWidth) x = window.innerWidth - 184;
  if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  setTimeout(() => document.addEventListener('click', closeCtx, { once: true }), 10);
}
function closeCtx() {
  document.getElementById('contextMenu')?.classList.add('ctx-hidden');
}
function copyMsg(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) navigator.clipboard?.writeText(el.textContent.trim());
  closeCtx();
}
function deleteMsg(msgId, convId) {
  S.socket?.emit('message:delete', { msgId, convId });
}

// ── RECORDING ─────────────────────────────────────────────────
function startRec(e) {
  if (e) e.preventDefault();
  if (!S.currentConvId) return;
  S.recording = true;
  S.recSeconds = 0;
  const btn = document.getElementById('recBtn');
  if (btn) { btn.classList.add('rec-active'); btn.textContent = '⏹️'; }

  const box = document.querySelector('.msg-box');
  if (box) box.innerHTML = `
    <div class="rec-ui">
      <span class="rec-time" id="recTime">0:00</span>
      <div class="rec-waves">
        <div class="rec-wave-bar"></div><div class="rec-wave-bar"></div>
        <div class="rec-wave-bar"></div><div class="rec-wave-bar"></div>
        <div class="rec-wave-bar"></div>
      </div>
      <button onclick="cancelRec()" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.2);color:var(--red);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Annuler</button>
    </div>`;

  S.recInterval = setInterval(() => {
    S.recSeconds++;
    const m = Math.floor(S.recSeconds / 60), s = S.recSeconds % 60;
    const el = document.getElementById('recTime');
    if (el) el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }, 1000);
}

function stopRec() {
  if (!S.recording) return;
  S.recording = false;
  clearInterval(S.recInterval);
  const btn = document.getElementById('recBtn');
  if (btn) { btn.classList.remove('rec-active'); btn.textContent = '🎙️'; }

  restoreInputBox();

  if (S.recSeconds < 1 || !S.currentConvId) return;
  const m = Math.floor(S.recSeconds / 60), s = S.recSeconds % 60;
  const duration = `${m}:${s.toString().padStart(2,'0')}`;

  S.socket?.emit('message:send', {
    convId: S.currentConvId, type: 'voice', duration, tempId: 'tmp_' + Date.now()
  });
}

function cancelRec() {
  S.recording = false;
  clearInterval(S.recInterval);
  const btn = document.getElementById('recBtn');
  if (btn) { btn.classList.remove('rec-active'); btn.textContent = '🎙️'; }
  restoreInputBox();
}

function restoreInputBox() {
  const box = document.querySelector('.msg-box');
  if (box) box.innerHTML = `
    <textarea class="msg-textarea" id="msgInput" placeholder="Écris un message..." rows="1"
      onkeydown="handleMsgKey(event)" oninput="handleTypingInput(this)"></textarea>
    <span class="emoji-trigger" onclick="toggleEmojiPicker()">😊</span>`;
}

function playVoice(btn, msgId) {
  const isPlaying = btn.textContent === '⏸';
  btn.textContent = isPlaying ? '▶' : '⏸';
  const row = btn.closest('.voice-msg');
  if (!isPlaying) {
    row?.classList.add('playing');
    setTimeout(() => { btn.textContent = '▶'; row?.classList.remove('playing'); }, 3000);
  } else {
    row?.classList.remove('playing');
  }
}

// ── EMOJI PICKER ──────────────────────────────────────────────
const EMOJI_SETS = {
  '😊': ['😊','😂','🤣','❤️','😍','🔥','👍','✨','😭','😤','🥳','😎','💀','👀','🤡','🎉','💯','🫡','🥰','😏'],
  '🍔': ['🍕','🍔','🍟','🌮','🍜','🍣','🍰','☕','🎂','🍦','🥑','🍓'],
  '⚽': ['⚽','🏀','🎮','🎸','🎵','🏆','🎯','🎲','🎭','🏋️'],
  '🌍': ['🌍','🏠','🌅','🌊','🌸','🌿','⛰️','🌙','☀️','🌈'],
};

function toggleEmojiPicker() {
  const zone = document.getElementById('emojiPickerZone');
  if (!zone) return;
  if (zone.style.display === 'none' || !zone.innerHTML) {
    zone.style.display = 'block';
    zone.innerHTML = buildEmojiPicker();
  } else {
    zone.style.display = 'none';
  }
}

function buildEmojiPicker() {
  const tabs = Object.keys(EMOJI_SETS);
  return `
  <div class="emoji-picker">
    <div class="ep-tabs">${tabs.map((t,i) => `<button class="ep-tab ${i===0?'active':''}" onclick="switchEmojiTab(this,'${t}')">${t}</button>`).join('')}</div>
    <div class="ep-grid" id="epGrid">${EMOJI_SETS[tabs[0]].map(e => `<div class="ep-emoji" onclick="insertEmoji('${e}')">${e}</div>`).join('')}</div>
  </div>`;
}

function switchEmojiTab(btn, cat) {
  document.querySelectorAll('.ep-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('epGrid').innerHTML = EMOJI_SETS[cat].map(e => `<div class="ep-emoji" onclick="insertEmoji('${e}')">${e}</div>`).join('');
}

function insertEmoji(e) {
  const inp = document.getElementById('msgInput');
  if (inp) { inp.value += e; inp.focus(); }
  document.getElementById('emojiPickerZone').style.display = 'none';
}

// ── MEDIA ─────────────────────────────────────────────────────
function triggerMedia() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file || !S.currentConvId) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      S.socket?.emit('message:send', {
        convId: S.currentConvId, type: 'image', content: e.target.result, tempId: 'tmp_' + Date.now()
      });
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

function viewImage(src) {
  const modal = document.getElementById('modalContainer');
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="this.parentElement.innerHTML=''">
      <img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:16px;box-shadow:var(--shadow-lg);">
    </div>`;
}

// ── PROFILE PANEL ─────────────────────────────────────────────
function toggleProfilePanel() {
  S.profilePanelOpen = !S.profilePanelOpen;
  let panel = document.getElementById('profileSidePanel');

  if (S.profilePanelOpen) {
    if (!panel) {
      const content = document.getElementById('content');
      panel = document.createElement('div');
      panel.id = 'profileSidePanel';
      panel.className = 'profile-side';
      content.style.flexDirection = 'row';
      // Rearrange: chat wrapper + profile side
      const chatWrapper = document.createElement('div');
      chatWrapper.id = 'chatWrapper';
      chatWrapper.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;';
      [...content.children].forEach(el => chatWrapper.appendChild(el));
      content.appendChild(chatWrapper);
      content.appendChild(panel);
    }
    const conv = S.conversations.find(c => c.id === S.currentConvId);
    const u = conv?.otherUser;
    const av = u?.avatar ? `<img src="${u.avatar}">` : getInitials(u?.displayName);
    const avStyle = u?.avatar ? '' : `style="width:72px;height:72px;background:${getUserGradient(u?.id)};display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:white;"`;
    panel.innerHTML = `
      <div class="ps-header"><button class="ha-btn" onclick="toggleProfilePanel()">✕</button></div>
      <div class="ps-avatar" ${avStyle}>${av}</div>
      <div class="ps-name">${escHtml(u?.displayName || '')}</div>
      <div class="ps-username">${escHtml(u?.username ? '@'+u.username : '')}</div>
      <div class="ps-status">${u?.isOnline ? '● En ligne' : '● Hors ligne'}</div>
      <div class="ps-actions">
        <button class="ps-action" onclick="startCall('voice')"><span class="ps-action-icon">📞</span>Appel</button>
        <button class="ps-action" onclick="startCall('video')"><span class="ps-action-icon">📹</span>Vidéo</button>
        <button class="ps-action"><span class="ps-action-icon">🔔</span>Notifs</button>
        <button class="ps-action"><span class="ps-action-icon">🚫</span>Bloquer</button>
      </div>
      <div class="ps-section">
        <div class="ps-section-title">Médias partagés</div>
        <div class="ps-media-grid">
          ${['🌅','🎵','🎮','📸','🌊','✨'].map(e => `<div class="ps-media-item">${e}</div>`).join('')}
        </div>
      </div>
    `;
    setTimeout(() => panel.classList.add('open'), 10);
  } else {
    if (panel) {
      panel.classList.remove('open');
      setTimeout(() => {
        const content = document.getElementById('content');
        const wrapper = document.getElementById('chatWrapper');
        if (wrapper) {
          [...wrapper.children].forEach(el => content.appendChild(el));
          wrapper.remove();
        }
        panel.remove();
        content.style.flexDirection = 'column';
      }, 300);
    }
  }
}

// ── SEARCH USERS ──────────────────────────────────────────────
let searchDebounce = null;
async function searchUsers(q) {
  clearTimeout(searchDebounce);
  if (!q.trim()) {
    document.getElementById('searchResultsList').innerHTML = `<div style="padding:32px 16px;text-align:center;color:var(--text3);font-size:14px;">Tape un nom ou pseudo pour rechercher</div>`;
    return;
  }
  searchDebounce = setTimeout(async () => {
    try {
      const { users } = await api.get(`/api/users/search?q=${encodeURIComponent(q)}`);
      renderSearchResults(users);
    } catch (e) { console.warn(e); }
  }, 300);
}

function renderSearchResults(users) {
  const list = document.getElementById('searchResultsList');
  if (!list) return;
  if (users.length === 0) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:14px;">Aucun utilisateur trouvé</div>`;
    return;
  }
  list.innerHTML = users.map(u => {
    const av = u.avatar ? `<img class="conv-avatar-img" src="${u.avatar}">` : `<div class="conv-avatar-fallback" style="background:${getUserGradient(u.id)}">${getInitials(u.displayName)}</div>`;
    let btnHtml;
    if (u.isFriend) {
      btnHtml = `<button class="add-friend-btn friends" onclick="openDM('${u.id}')">💬 Message</button>`;
    } else if (u.requestSent) {
      btnHtml = `<button class="add-friend-btn pending">⏳ Envoyé</button>`;
    } else {
      btnHtml = `<button class="add-friend-btn" onclick="addFriend('${u.id}',this)">+ Ajouter</button>`;
    }
    return `
    <div class="search-result-item">
      <div class="conv-avatar">${av}${u.isOnline ? '<div class="online-ring"></div>' : ''}</div>
      <div class="conv-info">
        <div class="conv-name">${escHtml(u.displayName)}</div>
        <div class="conv-preview">@${escHtml(u.username)}</div>
      </div>
      ${btnHtml}
    </div>`;
  }).join('');
}

async function addFriend(userId, btn) {
  try {
    const { status } = await api.post(`/api/users/${userId}/friend`);
    if (status === 'accepted') {
      btn.className = 'add-friend-btn friends';
      btn.textContent = '💬 Message';
      btn.onclick = () => openDM(userId);
      showToast('🎉', 'Ami ajouté !', 'Vous pouvez maintenant vous écrire.');
      loadConversations();
    } else {
      btn.className = 'add-friend-btn pending';
      btn.textContent = '⏳ Envoyé';
      showToast('✉️', 'Demande envoyée !', 'En attente d\'acceptation.');
    }
  } catch (e) { showToast('❌', 'Erreur', e.message); }
}

async function openDM(userId) {
  try {
    const { conversation } = await api.post(`/api/messages/conversation/${userId}`);
    await loadConversations();
    setPanel('messages');
    openConversation(conversation.id);
  } catch (e) { console.warn(e); }
}

// ── FRIEND REQUESTS ───────────────────────────────────────────
async function loadFriendRequests() {
  try {
    const { requests } = await api.get('/api/users/me/requests');
    const list = document.getElementById('requestsList');
    if (!list) return;
    const badge = document.getElementById('requestsBadge');
    if (badge) {
      badge.textContent = requests.length;
      badge.classList.toggle('hidden', requests.length === 0);
    }
    if (requests.length === 0) {
      list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:14px;">Aucune demande en attente</div>`;
      return;
    }
    list.innerHTML = requests.map(u => {
      const av = u.avatar ? `<img class="conv-avatar-img" src="${u.avatar}">` : `<div class="conv-avatar-fallback" style="background:${getUserGradient(u.id)}">${getInitials(u.displayName)}</div>`;
      return `
      <div class="search-result-item" id="req-${u.id}">
        <div class="conv-avatar">${av}</div>
        <div class="conv-info">
          <div class="conv-name">${escHtml(u.displayName)}</div>
          <div class="conv-preview">@${escHtml(u.username)}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary btn-sm" onclick="acceptReq('${u.id}')">✓</button>
          <button class="btn btn-ghost btn-sm" onclick="declineReq('${u.id}')">✕</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) { console.warn(e); }
}

async function acceptReq(userId) {
  try {
    await api.post(`/api/users/${userId}/friend/accept`);
    document.getElementById(`req-${userId}`)?.remove();
    showToast('🎉', 'Demande acceptée !', 'Vous pouvez maintenant vous écrire.');
    loadConversations();
    loadFriendRequests();
  } catch (e) { showToast('❌', 'Erreur', e.message); }
}

async function declineReq(userId) {
  document.getElementById(`req-${userId}`)?.remove();
}

// ── CALLS ─────────────────────────────────────────────────────
async function startCall(type) {
  if (!S.currentConvId) return;
  const conv = S.conversations.find(c => c.id === S.currentConvId);
  if (!conv) return;
  const target = conv.otherUser;
  const callId = `${S.user.id}::${target.id}::${Date.now()}`;
  S.call = { callId, targetId: target.id, type, initiated: true };

  S.socket?.emit('call:invite', { targetId: target.id, type, callId });
  showCallUI(target, type, 'Appel en cours...', callId);
}

function showCallUI(target, type, statusText, callId) {
  const overlay = document.getElementById('callOverlay');
  overlay.classList.remove('hidden');

  const av = target.avatar ? `<img src="${target.avatar}">` : getInitials(target.displayName);
  const avStyle = target.avatar ? '' : `style="background:${getUserGradient(target.id)}"`;

  overlay.innerHTML = `
    <div id="remoteVideoEl" style="position:absolute;inset:0;background:${getUserGradient(target.id)};display:none;"></div>
    <video id="remoteVideoActual" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;" autoplay playsinline></video>
    <div id="selfVideoPip" class="self-video-pip portrait" style="display:none;">
      <video id="selfVideoEl" autoplay playsinline muted></video>
    </div>
    <div class="call-fmt-toggle" id="callFmtToggle" style="display:none;">
      <button class="fmt-btn active" onclick="setCallFmt('portrait')">Portrait</button>
      <button class="fmt-btn" onclick="setCallFmt('landscape')">Paysage</button>
    </div>
    <div class="call-voice-ui" id="callVoiceUI">
      <span class="call-label">${type === 'video' ? 'Appel vidéo' : 'Appel vocal'}</span>
      <div class="call-big-avatar" ${avStyle}>
        ${av}
        <div class="call-ripple"></div><div class="call-ripple r2"></div><div class="call-ripple r3"></div>
      </div>
      <div class="call-name">${escHtml(target.displayName)}</div>
      <div class="call-status" id="callStatusTxt">${statusText}</div>
      <div class="call-duration hidden" id="callDurationEl">00:00</div>
    </div>
    <div class="call-controls" id="callControls">
      <div class="cc-wrap">
        <button class="cc-btn mute-btn" id="muteBtnEl" onclick="toggleMute()">🎙️</button>
        <span class="cc-label">Micro</span>
      </div>
      ${type === 'video' ? `
      <div class="cc-wrap">
        <button class="cc-btn cam-btn" id="camBtnEl" onclick="toggleCam()">📷</button>
        <span class="cc-label">Caméra</span>
      </div>
      <div class="cc-wrap">
        <button class="cc-btn flip-btn" onclick="flipCam()">🔄</button>
        <span class="cc-label">Flip</span>
      </div>` : ''}
      <div class="cc-wrap">
        <button class="cc-btn end-btn" onclick="endCall()">📵</button>
        <span class="cc-label" style="color:var(--red)">Raccrocher</span>
      </div>
      <div class="cc-wrap">
        <button class="cc-btn spk-btn" onclick="toggleSpeaker()">🔊</button>
        <span class="cc-label">Son</span>
      </div>
    </div>
  `;

  if (type === 'video') {
    startVideoStream();
    document.getElementById('callFmtToggle').style.display = 'flex';
  }
}

async function startVideoStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    S.callStream = stream;
    const selfVid = document.getElementById('selfVideoEl');
    if (selfVid) {
      selfVid.srcObject = stream;
      document.getElementById('selfVideoPip').style.display = 'block';
    }
  } catch (e) {
    console.warn('Camera access denied:', e);
  }
}

function onCallAccepted(callId) {
  const statusEl = document.getElementById('callStatusTxt');
  if (statusEl) { statusEl.textContent = '● Connecté(e)'; statusEl.className = 'call-status connected'; }
  const durEl = document.getElementById('callDurationEl');
  if (durEl) durEl.classList.remove('hidden');

  let sec = 0;
  S.callTimer = setInterval(() => {
    sec++;
    const m = Math.floor(sec/60), s = sec % 60;
    if (durEl) durEl.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }, 1000);
}

function endCall() {
  if (S.call) {
    S.socket?.emit('call:end', { callId: S.call.callId, targetId: S.call.targetId });
  }
  endCallUI();
}

function endCallUI() {
  clearInterval(S.callTimer);
  if (S.callStream) { S.callStream.getTracks().forEach(t => t.stop()); S.callStream = null; }
  const overlay = document.getElementById('callOverlay');
  overlay?.classList.add('hidden');
  overlay.innerHTML = '';
  S.call = null;
}

function showIncomingCall({ callId, callerId, type, callerName, callerAvatar }) {
  const banner = document.getElementById('incomingCallBanner');
  const av = callerAvatar ? `<img src="${callerAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : callerName?.slice(0,2).toUpperCase() || '?';
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="icb-avatar">${av}</div>
    <div class="icb-info">
      <div class="icb-name">${escHtml(callerName || 'Inconnu')}</div>
      <div class="icb-type">${type === 'video' ? '📹 Appel vidéo entrant' : '📞 Appel vocal entrant'}</div>
    </div>
    <div class="icb-actions">
      <button class="icb-accept" onclick="acceptCall('${callId}','${callerId}','${type}','${callerName}','${callerAvatar||''}')">📞</button>
      <button class="icb-decline" onclick="declineCall('${callId}','${callerId}')">📵</button>
    </div>
  `;
  // Auto-dismiss after 30s
  setTimeout(() => { declineCall(callId, callerId); }, 30000);
}

function acceptCall(callId, callerId, type, callerName, callerAvatar) {
  document.getElementById('incomingCallBanner').classList.add('hidden');
  S.call = { callId, targetId: callerId, type, initiated: false };
  S.socket?.emit('call:accept', { callId, callerId });
  showCallUI({ id: callerId, displayName: callerName, avatar: callerAvatar || null }, type, '● Connecté(e)', callId);
  onCallAccepted(callId);
}

function declineCall(callId, callerId) {
  document.getElementById('incomingCallBanner').classList.add('hidden');
  S.socket?.emit('call:decline', { callId, callerId });
}

// WebRTC (simplified - ICE only for video)
async function handleWebRTCOffer(data) {}
async function handleWebRTCAnswer(data) {}
async function handleWebRTCIce(data) {}

function toggleMute() {
  const btn = document.getElementById('muteBtnEl');
  if (S.callStream) S.callStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
  btn?.classList.toggle('on');
  if (btn) btn.textContent = btn.classList.contains('on') ? '🔇' : '🎙️';
}

function toggleCam() {
  const btn = document.getElementById('camBtnEl');
  if (S.callStream) S.callStream.getVideoTracks().forEach(t => t.enabled = !t.enabled);
  btn?.classList.toggle('on');
}

function flipCam() {
  const pip = document.getElementById('selfVideoPip');
  if (pip) { pip.style.transform = 'scale(0.9)'; setTimeout(() => pip.style.transform = '', 200); }
}

function toggleSpeaker() {
  const btn = document.querySelector('.spk-btn');
  btn?.classList.toggle('on');
  if (btn) btn.textContent = btn.classList.contains('on') ? '🔈' : '🔊';
}

function setCallFmt(fmt) {
  const pip = document.getElementById('selfVideoPip');
  if (!pip) return;
  pip.className = `self-video-pip ${fmt}`;
  document.querySelectorAll('.fmt-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && fmt === 'portrait') || (i === 1 && fmt === 'landscape'));
  });
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings() {
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <div class="panel-head">
      <div class="panel-head-row"><span class="panel-head-title">Paramètres</span></div>
    </div>
    <div class="panel-scroll" style="padding:8px 4px;"></div>
  `;

  const content = document.getElementById('content');
  const u = S.user;
  const avContent = u.avatar ? `<img src="${u.avatar}">` : `<div style="width:80px;height:80px;background:${getUserGradient(u.id)};display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:white;border-radius:50%;">${getInitials(u.displayName)}</div>`;

  content.innerHTML = `
    <div class="settings-view">
      <div class="sv-section">
        <div class="sv-avatar-wrap">
          <div class="sv-avatar" onclick="document.getElementById('svAvatarIn').click()">
            ${avContent}
            <div class="sv-avatar-overlay">✏️</div>
          </div>
          <input type="file" id="svAvatarIn" accept="image/*" style="display:none" onchange="uploadAvatar(this)">
          <div>
            <div class="sv-name" id="svName">${escHtml(u.displayName)}</div>
            <div class="sv-username">@${escHtml(u.username)}</div>
          </div>
        </div>
      </div>

      <div class="sv-section">
        <div class="sv-section-title">Modifier le profil</div>
        <div class="form-group">
          <label class="form-label">Nom d'affichage</label>
          <input class="form-input" id="svDisplayName" value="${escHtml(u.displayName)}" placeholder="Ton nom">
        </div>
        <div class="form-group">
          <label class="form-label">Pseudo</label>
          <input class="form-input" id="svUsername" value="${escHtml(u.username)}" placeholder="pseudo">
        </div>
        <div class="form-group">
          <label class="form-label">Bio</label>
          <input class="form-input" id="svBio" value="${escHtml(u.bio || '')}" placeholder="Dis quelque chose sur toi...">
        </div>
        <button class="btn btn-primary" onclick="saveProfile()" style="margin-top:4px;">Sauvegarder →</button>
      </div>

      <div class="sv-section">
        <div class="sv-section-title">Préférences</div>
        <div class="sv-toggle-row">
          <div class="sv-toggle-info">
            <div class="sv-tl">Notifications</div>
            <div class="sv-ts">Recevoir des alertes</div>
          </div>
          <div class="toggle on" id="notifToggle" onclick="this.classList.toggle('on')">
            <div class="toggle-knob"></div>
          </div>
        </div>
      </div>

      <div class="sv-section">
        <div class="sv-section-title">Compte</div>
        <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;">
          <div style="font-size:14px;font-weight:600;">Email</div>
          <div style="font-size:13px;color:var(--text2);margin-top:2px;">${escHtml(u.email)}</div>
        </div>
        <button class="btn btn-danger btn-full" onclick="logout()">Se déconnecter</button>
      </div>
    </div>
  `;
}

async function saveProfile() {
  const displayName = document.getElementById('svDisplayName')?.value.trim();
  const username = document.getElementById('svUsername')?.value.trim();
  const bio = document.getElementById('svBio')?.value.trim();
  try {
    const { user } = await api.patch('/api/users/me', { displayName, username, bio });
    S.user = user;
    localStorage.setItem('chatly_user', JSON.stringify(user));
    document.getElementById('svName').textContent = user.displayName;
    showToast('✅', 'Profil mis à jour', 'Tes modifications ont été sauvegardées.');
  } catch (e) { showToast('❌', 'Erreur', e.message); }
}

async function uploadAvatar(inp) {
  const file = inp.files[0]; if (!file) return;
  try {
    const { avatar } = await api.uploadAvatar(file);
    S.user.avatar = avatar;
    localStorage.setItem('chatly_user', JSON.stringify(S.user));
    renderSettings(); // re-render to show new avatar
    // Update sidebar avatar
    const sbAv = document.getElementById('sbAvatar');
    if (sbAv) sbAv.innerHTML = `<img src="${avatar}">`;
    showToast('🖼️', 'Photo mise à jour', '');
  } catch (e) { showToast('❌', 'Erreur', e.message); }
}

// ── AUTH ──────────────────────────────────────────────────────
function showLanding() {
  document.getElementById('app').innerHTML = `
    <div style="width:100%;min-height:100vh;overflow-y:auto;background:var(--bg);">
      <nav class="landing-nav">
        <div class="brand-logo">Chatly</div>
        <div class="nav-actions">
          <button class="btn btn-ghost btn-sm" onclick="showLogin()">Se connecter</button>
          <button class="btn btn-white btn-sm" onclick="showRegister()">Créer un compte</button>
        </div>
      </nav>
      <section class="hero-section">
        <div class="hero-bg-blobs">
          <div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>
        </div>
        <div class="hero-content">
          <div class="hero-eyebrow"><div class="eyebrow-dot"></div>Messages éphémères — 24h puis disparu</div>
          <h1 class="hero-title">Vis l'instant.<br><span class="title-gradient">Parle vrai.</span></h1>
          <p class="hero-desc">Chatly est l'endroit où tes conversations existent pleinement — messages, vocaux, appels vidéo — et s'effacent après 24h. Zéro pression. Juste du vrai.</p>
          <div class="hero-cta">
            <button class="btn btn-white" onclick="showRegister()" style="font-size:16px;padding:14px 32px;">Rejoindre gratuitement →</button>
            <button class="btn btn-ghost" onclick="showLogin()" style="font-size:16px;padding:14px 32px;">Se connecter</button>
          </div>
        </div>
      </section>
      <div class="features-grid-landing">
        ${[
          ['💬','Messages instantanés','Texte, émojis, images — tout disparaît après 24h. Aucune pression de l\'historique.'],
          ['🎙️','Messages vocaux','Maintiens le bouton mic, parle, relâche. Ta voix, ton émotion — livré.'],
          ['📹','Appels vidéo HD','Appels vidéo en un tap, mode portrait & paysage, flip camera, micro on/off.'],
          ['🔍','Recherche d\'utilisateurs','Trouve tes amis par pseudo ou nom. Bouton ajouter, demande acceptée — c\'est parti.'],
          ['⏱️','Timer 24h en direct','Chaque message affiche son temps restant en temps réel. Vert → jaune → rouge.'],
          ['😊','Réactions rapides','Long press ou clic droit sur un message pour réagir avec un emoji.'],
        ].map(([icon,title,desc]) => `
          <div class="feature-pill">
            <div class="pill-icon">${icon}</div>
            <div class="pill-title">${title}</div>
            <div class="pill-desc">${desc}</div>
          </div>`).join('')}
      </div>
      <div style="text-align:center;padding:0 0 80px;color:var(--text3);font-size:14px;">
        <span style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:var(--green);border-radius:8px;padding:6px 14px;font-weight:600;">
          Compte de démo : alice / demo1234
        </span>
      </div>
    </div>
  `;
}

function showLogin() {
  document.getElementById('app').innerHTML = `
    <div class="auth-card-page">
      <div class="auth-card">
        <div class="auth-card-header">
          <span class="auth-logo">Chatly</span>
          <div class="auth-title">Bon retour 👋</div>
          <div class="auth-sub">Connecte-toi à ton compte</div>
        </div>
        <div class="form-group">
          <label class="form-label">Email ou pseudo</label>
          <input class="form-input" id="loginId" placeholder="alice ou alice@email.com" autocomplete="username">
        </div>
        <div class="form-group">
          <label class="form-label">Mot de passe</label>
          <input class="form-input" id="loginPwd" type="password" placeholder="••••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <div class="form-error" id="loginErr"></div>
        <button class="btn btn-primary btn-full" id="loginBtn" onclick="doLogin()" style="margin-top:8px;">Se connecter →</button>
        <div class="auth-link">Pas de compte ? <a onclick="showRegister()">Créer un compte</a></div>
        <div class="auth-link" style="margin-top:8px;"><a onclick="showLanding()">← Retour</a></div>
      </div>
    </div>
  `;
  document.getElementById('loginId').focus();
}

async function doLogin() {
  const identifier = document.getElementById('loginId')?.value.trim();
  const password = document.getElementById('loginPwd')?.value;
  const err = document.getElementById('loginErr');
  const btn = document.getElementById('loginBtn');
  err.classList.remove('visible');
  btn.classList.add('btn-loading');
  try {
    const { token, user } = await api.post('/api/auth/login', { identifier, password });
    S.token = token; S.user = user;
    localStorage.setItem('chatly_token', token);
    localStorage.setItem('chatly_user', JSON.stringify(user));
    launchApp();
  } catch (e) {
    btn.classList.remove('btn-loading');
    err.textContent = e.message; err.classList.add('visible');
  }
}

function showRegister() {
  document.getElementById('app').innerHTML = `
    <div class="auth-card-page">
      <div class="auth-card" style="max-width:460px;">
        <div class="auth-card-header">
          <span class="auth-logo">Chatly</span>
          <div class="auth-title">Créer un compte</div>
          <div class="auth-sub">Rejoins Chatly en 30 secondes</div>
        </div>
        <div class="avatar-upload-zone">
          <div class="avatar-upload-btn" id="avatarUpBtn" onclick="document.getElementById('avatarUpIn').click()">
            <span id="avatarUpEmoji">📷</span>
            <div class="cam-overlay">✏️</div>
          </div>
          <input type="file" id="avatarUpIn" accept="image/*" onchange="previewRegAvatar(this)" style="display:none">
          <div class="avatar-hint">Photo de profil (optionnel)</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Prénom</label>
            <input class="form-input" id="regFirst" placeholder="Prénom">
          </div>
          <div class="form-group">
            <label class="form-label">Nom</label>
            <input class="form-input" id="regLast" placeholder="Nom">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Pseudo</label>
          <input class="form-input" id="regUser" placeholder="ton_pseudo" oninput="this.value=this.value.replace(/[^a-zA-Z0-9_]/g,'')">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-input" id="regEmail" type="email" placeholder="toi@email.com">
        </div>
        <div class="form-group">
          <label class="form-label">Mot de passe</label>
          <input class="form-input" id="regPwd" type="password" placeholder="8 caractères minimum" onkeydown="if(event.key==='Enter')doRegister()">
        </div>
        <div class="form-error" id="regErr"></div>
        <button class="btn btn-primary btn-full" id="regBtn" onclick="doRegister()" style="margin-top:8px;">Créer mon compte →</button>
        <div class="auth-link">Déjà membre ? <a onclick="showLogin()">Se connecter</a></div>
      </div>
    </div>
  `;
  document.getElementById('regFirst').focus();
}

let regAvatarFile = null;
function previewRegAvatar(inp) {
  const file = inp.files[0]; if (!file) return;
  regAvatarFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const btn = document.getElementById('avatarUpBtn');
    btn.innerHTML = `<img src="${e.target.result}"><div class="cam-overlay">✏️</div>`;
  };
  reader.readAsDataURL(file);
}

async function doRegister() {
  const first = document.getElementById('regFirst')?.value.trim();
  const last = document.getElementById('regLast')?.value.trim();
  const username = document.getElementById('regUser')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  const password = document.getElementById('regPwd')?.value;
  const displayName = `${first} ${last}`.trim() || username;
  const err = document.getElementById('regErr');
  const btn = document.getElementById('regBtn');
  err.classList.remove('visible');
  btn.classList.add('btn-loading');
  try {
    const { token, user } = await api.post('/api/auth/register', { username, email, password, displayName });
    S.token = token; S.user = user;
    localStorage.setItem('chatly_token', token);
    localStorage.setItem('chatly_user', JSON.stringify(user));
    // Upload avatar if provided
    if (regAvatarFile) {
      try { await api.uploadAvatar(regAvatarFile); } catch {}
    }
    launchApp();
  } catch (e) {
    btn.classList.remove('btn-loading');
    err.textContent = e.message; err.classList.add('visible');
  }
}

function logout(redirect = true) {
  S.token = null; S.user = null;
  localStorage.removeItem('chatly_token');
  localStorage.removeItem('chatly_user');
  S.socket?.disconnect();
  if (redirect) showLanding();
}

// ── EMPTY STATE ───────────────────────────────────────────────
function renderEmptyState() {
  document.getElementById('content').innerHTML = `
    <div class="empty-state" style="flex:1;display:flex;flex-direction:column;">
      <div class="empty-icon">💬</div>
      <div class="empty-title">Bienvenue sur Chatly</div>
      <div class="empty-body">Sélectionne une conversation ou ajoute des amis pour commencer à écrire !</div>
    </div>
  `;
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(icon, title, msg, onClick) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cursor = onClick ? 'pointer' : 'default';
  toast.innerHTML = `<div class="toast-icon">${icon}</div><div class="toast-body"><div class="toast-title">${escHtml(title)}</div>${msg ? `<div class="toast-msg">${escHtml(msg)}</div>` : ''}</div>`;
  if (onClick) toast.onclick = onClick;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── UTILS ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0,2).toUpperCase();
}

const GRADIENTS = [
  'linear-gradient(135deg,#5B6AF7,#A855F7)',
  'linear-gradient(135deg,#EF4444,#F97316)',
  'linear-gradient(135deg,#22C55E,#3B82F6)',
  'linear-gradient(135deg,#EAB308,#F97316)',
  'linear-gradient(135deg,#A855F7,#EC4899)',
  'linear-gradient(135deg,#3B82F6,#22C55E)',
];
function getUserGradient(id) {
  if (!id) return GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'maintenant';
  if (diff < 3600000) return `${Math.floor(diff/60000)}min`;
  if (d.toDateString() === now.toDateString()) return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  return `${d.getDate()}/${d.getMonth()+1}`;
}

function getHoursLeft(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 3600000);
}

// Close emoji picker on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.emoji-trigger') && !e.target.closest('.emoji-picker')) {
    const z = document.getElementById('emojiPickerZone');
    if (z) z.style.display = 'none';
  }
  if (!e.target.closest('#contextMenu') && !e.target.closest('.msg-bubble') && !e.target.closest('.voice-msg')) {
    closeCtx();
  }
});

// ── BOOT ──────────────────────────────────────────────────────
init();
