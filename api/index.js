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
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
});

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes API ─────────────────────────────────────────────────
app.use('/api/auth',     require('../src/routes/auth'));
app.use('/api/users',    require('../src/routes/users'));
app.use('/api/messages', require('../src/routes/messages'));
app.use('/api/calls',    require('../src/routes/calls'));

// ── DB + Sockets ───────────────────────────────────────────────
const db = require('../src/db');
require('../src/socket')(io, db);

// ── SPA fallback ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Démarrage (local uniquement) ───────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🚀 Chatly → http://localhost:${PORT}\n`);
  });
}

// ── Export pour Vercel ─────────────────────────────────────────
// DOIT être "app" (fonction Express), PAS "server" (http.Server)
module.exports = app;
