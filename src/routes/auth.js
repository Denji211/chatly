const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'chatly_super_secret_2025_change_in_prod';
const signToken = (user) => jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, email, password, displayName } = req.body;

  if (!username || !email || !password || !displayName) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (username.length < 3 || username.length > 24) {
    return res.status(400).json({ error: 'Pseudo : 3-24 caractères' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Pseudo : lettres, chiffres et _ uniquement' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (8 min)' });
  }
  if (db.usersByUsername.has(username.toLowerCase())) {
    return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
  }
  if (db.usersByEmail.has(email.toLowerCase())) {
    return res.status(409).json({ error: 'Cet email est déjà utilisé' });
  }

  const user = db.createUser({ username, email, password, displayName });
  const token = signToken(user);
  res.status(201).json({ token, user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { identifier, password } = req.body; // identifier = email or username

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }

  const fullUser = identifier.includes('@')
    ? db.getUserByEmail(identifier)
    : db.users.get(db.usersByUsername.get(identifier.toLowerCase()));

  if (!fullUser || !bcrypt.compareSync(password, fullUser.passwordHash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const user = db.sanitizeUser(fullUser);
  const token = signToken(user);
  res.json({ token, user });
});

// GET /api/auth/me
const authMiddleware = require('../middleware/auth');
router.get('/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ user });
});

module.exports = router;
