const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');

router.post('/initiate', auth, (req, res) => {
  const { targetId, type } = req.body;
  const callId = `${req.user.id}::${targetId}::${Date.now()}`;
  res.json({ callId });
});

module.exports = router;
