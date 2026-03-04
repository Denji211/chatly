const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db');

// Active calls in memory
const activeCalls = new Map();

// POST /api/calls/initiate — initiates call, notifies via socket
router.post('/initiate', auth, (req, res) => {
  const { targetId, type } = req.body; // type: 'voice' | 'video'
  const target = db.getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const callId = `${req.user.id}::${targetId}::${Date.now()}`;
  activeCalls.set(callId, {
    id: callId, callerId: req.user.id, calleeId: targetId,
    type, status: 'ringing', startedAt: Date.now()
  });

  res.json({ callId });
});

// GET /api/calls/active
router.get('/active', auth, (req, res) => {
  const calls = [];
  for (const [, call] of activeCalls) {
    if (call.callerId === req.user.id || call.calleeId === req.user.id) {
      calls.push(call);
    }
  }
  res.json({ calls });
});

module.exports = router;
module.exports.activeCalls = activeCalls;
