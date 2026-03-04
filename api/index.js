require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Sur Vercel, on désactive les transports websocket natifs
  // et on utilise le polling long
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Routes API ───────────────────────────────────────────────
const authRoutes   = require('../src/routes/auth');
const userRoutes   = require('../src/routes/users');
const messageRoutes = require('../src/routes/messages');
const callRoutes   = require('../src/routes/calls');

app.use('/api/auth',     authRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calls',    callRoutes);

// ─── DB + Socket.io ───────────────────────────────────────────
const db = require('../src/db');
require('../src/socket')(io, db);

// ─── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Chatly on http://localhost:${PORT}`);
});

module.exports = app;
