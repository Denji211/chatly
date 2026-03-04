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
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const authRoutes    = require('../src/routes/auth');
const userRoutes    = require('../src/routes/users');
const messageRoutes = require('../src/routes/messages');
const callRoutes    = require('../src/routes/calls');

app.use('/api/auth',     authRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calls',    callRoutes);

const db = require('../src/db');
require('../src/socket')(io, db);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Démarrage local uniquement
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`🚀 Chatly on http://localhost:${PORT}`));
}

// Export pour Vercel — doit être le server HTTP, pas juste app
module.exports = server;
