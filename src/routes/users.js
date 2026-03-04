const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const db = require('../db');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Avatar upload (store as base64 in memory for simplicity/Vercel)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/users/search?q=
router.get('/search', auth, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 1) return res.json({ users: [] });
  const users = db.searchUsers(q, req.user.id);
  // Add friendship status
  const enriched = users.map(u => ({
    ...u,
    isFriend: db.isFriend(req.user.id, u.id),
    requestSent: db.friendRequests.get(u.id)?.has(req.user.id) || false,
    requestReceived: db.friendRequests.get(req.user.id)?.has(u.id) || false,
  }));
  res.json({ users: enriched });
});

// GET /api/users/:id
router.get('/:id', auth, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ user: {
    ...user,
    isFriend: db.isFriend(req.user.id, user.id)
  }});
});

// PATCH /api/users/me — update profile
router.patch('/me', auth, (req, res) => {
  const { displayName, bio, username } = req.body;
  if (username && db.usersByUsername.has(username.toLowerCase()) && username.toLowerCase() !== req.user.username) {
    return res.status(409).json({ error: 'Pseudo déjà pris' });
  }
  const user = db.updateUser(req.user.id, { displayName, bio, username });
  res.json({ user });
});

// POST /api/users/me/avatar — upload avatar
router.post('/me/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  db.updateUser(req.user.id, { avatar: base64 });
  res.json({ avatar: base64 });
});

// ── Friends ──────────────────────────────────────────────────

// GET /api/users/me/friends
router.get('/me/friends', auth, (req, res) => {
  const friends = db.getFriends(req.user.id);
  res.json({ friends });
});

// GET /api/users/me/requests
router.get('/me/requests', auth, (req, res) => {
  const requests = db.getPendingRequests(req.user.id);
  res.json({ requests });
});

// POST /api/users/:id/friend — send request
router.post('/:id/friend', auth, (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-même' });
  if (!db.getUserById(targetId)) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (db.isFriend(req.user.id, targetId)) return res.status(409).json({ error: 'Déjà ami' });

  // Check if target sent us a request -> auto-accept
  if (db.friendRequests.get(req.user.id)?.has(targetId)) {
    db.acceptFriendRequest(req.user.id, targetId);
    return res.json({ status: 'accepted', message: 'Vous êtes maintenant amis !' });
  }

  db.sendFriendRequest(req.user.id, targetId);
  res.json({ status: 'sent', message: 'Demande envoyée' });
});

// POST /api/users/:id/friend/accept
router.post('/:id/friend/accept', auth, (req, res) => {
  const ok = db.acceptFriendRequest(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Demande introuvable' });
  res.json({ status: 'accepted' });
});

// DELETE /api/users/:id/friend
router.delete('/:id/friend', auth, (req, res) => {
  db.removeFriend(req.user.id, req.params.id);
  res.json({ status: 'removed' });
});

module.exports = router;
