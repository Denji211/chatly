const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../db');

// GET /api/messages/conversations
router.get('/conversations', auth, (req, res) => {
  res.json({ conversations: db.getConversationsForUser(req.user.id) });
});

// POST /api/messages/conversation/:targetId
router.post('/conversation/:targetId', auth, (req, res) => {
  if (!db.getUserById(req.params.targetId))
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  const conversation = db.getOrCreateConversation(req.user.id, req.params.targetId);
  res.json({ conversation });
});

// GET /api/messages/:convId
router.get('/:convId', auth, (req, res) => {
  const conv = db.conversations.get(req.params.convId);
  if (!conv || !conv.participants.includes(req.user.id))
    return res.status(403).json({ error: 'Accès refusé' });
  db.markRead(req.params.convId, req.user.id);
  res.json({ messages: db.getMessages(req.params.convId) });
});

// DELETE /api/messages/:msgId
router.delete('/:msgId', auth, (req, res) => {
  const ok = db.deleteMessage(req.params.msgId, req.user.id);
  if (!ok) return res.status(403).json({ error: 'Impossible de supprimer' });
  res.json({ deleted: true });
});

// POST /api/messages/:msgId/react
router.post('/:msgId/react', auth, (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji requis' });
  const msg = db.addReaction(req.params.msgId, req.user.id, emoji);
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  res.json({ message: msg });
});

module.exports = router;
