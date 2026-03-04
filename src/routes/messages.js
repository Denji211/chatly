const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db');

// GET /api/messages/conversations
router.get('/conversations', auth, (req, res) => {
  const convs = db.getConversationsForUser(req.user.id);
  res.json({ conversations: convs });
});

// GET /api/messages/:convId
router.get('/:convId', auth, (req, res) => {
  const conv = db.conversations.get(req.params.convId);
  if (!conv || !conv.participants.includes(req.user.id)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const messages = db.getMessages(req.params.convId);
  // Serialize reactions (Set -> Array)
  const serialized = messages.map(m => ({
    ...m,
    reactions: Object.fromEntries(
      Object.entries(m.reactions).map(([k, v]) => [k, v instanceof Set ? [...v] : v])
    )
  }));
  db.markRead(req.params.convId, req.user.id);
  res.json({ messages: serialized });
});

// POST /api/messages/:convId — create conversation
router.post('/conversation/:targetId', auth, (req, res) => {
  const target = db.getUserById(req.params.targetId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const conv = db.getOrCreateConversation(req.user.id, req.params.targetId);
  res.json({ conversation: conv });
});

// DELETE /api/messages/:msgId — delete message
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
