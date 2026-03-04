const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../db');
const multer  = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/users/search?q=
router.get('/search', auth, (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.json({ users: [] });
  const users = db.searchUsers(q, req.user.id).map(u => ({
    ...u,
    isFriend:        db.isFriend(req.user.id, u.id),
    requestSent:     db.friendRequests.get(u.id)?.has(req.user.id) || false,
    requestReceived: db.friendRequests.get(req.user.id)?.has(u.id) || false,
  }));
  res.json({ users });
});

// GET /api/users/me/friends
router.get('/me/friends', auth, (req, res) => {
  res.json({ friends: db.getFriends(req.user.id) });
});

// GET /api/users/me/requests
router.get('/me/requests', auth, (req, res) => {
  res.json({ requests: db.getPendingRequests(req.user.id) });
});

// PATCH /api/users/me
router.patch('/me', auth, (req, res) => {
  const { displayName, bio, username } = req.body;
  if (username && db.usersByUsername.has(username.toLowerCase()) && username.toLowerCase() !== req.user.username)
    return res.status(409).json({ error: 'Pseudo déjà pris' });
  const user = db.updateUser(req.user.id, { displayName, bio, username });
  res.json({ user });
});

// POST /api/users/me/avatar
router.post('/me/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const avatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  db.updateUser(req.user.id, { avatar });
  res.json({ avatar });
});

// POST /api/users/:id/friend
router.post('/:id/friend', auth, (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-même' });
  if (!db.getUserById(targetId)) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (db.isFriend(req.user.id, targetId)) return res.status(409).json({ error: 'Déjà ami' });
  if (db.friendRequests.get(req.user.id)?.has(targetId)) {
    db.acceptFriendRequest(req.user.id, targetId);
    return res.json({ status: 'accepted' });
  }
  db.sendFriendRequest(req.user.id, targetId);
  res.json({ status: 'sent' });
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

// GET /api/users/:id
router.get('/:id', auth, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ user: { ...user, isFriend: db.isFriend(req.user.id, user.id) } });
});

module.exports = router;
