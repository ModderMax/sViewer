const express = require('express');
const router = express.Router();
const runSetup = require('../scripts/db-setup');
let lastUpdate = 0;
const COOLDOWN_MS = 60 * 1000;

router.post('/', (req, res) => {
  const now = Date.now();
  if (now - lastUpdate < COOLDOWN_MS) {
    return res.status(429).json({ message: 'Update on cooldown.' });
  }

  try {
    runSetup('--update');
    lastUpdate = now;
    res.json({ message: 'Database updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Update failed.', error: err.toString() });
  }
});

module.exports = router;