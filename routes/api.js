const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { exec } = require('child_process');

// Ensure the data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const router = express.Router();
const dbPath = path.join(dataDir, 'image_metadata.db');
const db = new Database(dbPath);

const COMPOSITE_TYPES = {
  'AVHRR_221': 'AVHRR 221',
  'AVHRR_3a21': 'AVHRR 3a21',
  'Cloud_Convection': 'Cloud Convection',
  'avhrr_3_rgb_MCIR_Rain_': 'MCIR Rain',
  'projected': 'Projection',
  'MSU-MR-': 'LRPT Channel',
  'L3_1': 'L3 Channel 1',
  'L3_2': 'L3 Channel 2',
  'L3_3': 'L3 Channel 3',
  'L3_4': 'L3 Channel 4',
  'L3_9': 'L3 Channel 9',
  '10.8um': '10.8um IR',
  'GS_321_': '321 False Color',
  'Natural_Color': 'Natural Color',
  'APT-A': 'APT Channel A',
  'APT-B': 'APT Channel B',
  'raw_': 'Raw APT',
  'AVHRR-2': 'AVHRR Channel 2',
  'AVHRR-4': 'AVHRR Channel 4'
};

router.get('/images', (req, res) => {
  let query = `
    SELECT images.*, passes.timestamp, passes.satellite, passes.rawDataPath
    FROM images
    JOIN passes ON images.passId = passes.id
    WHERE 1=1
  `;
  const params = [];

  if (req.query.satellite) {
    query += ` AND LOWER(passes.satellite) = LOWER(?)`;
    params.push(req.query.satellite);
  }

  if (req.query.composite) {
  const comps = Array.isArray(req.query.composite) ? req.query.composite : [req.query.composite];

  const compositeKeys = Object.entries(COMPOSITE_TYPES).filter(([key, label]) =>
    comps.includes(key)
  );

  if (compositeKeys.length > 0) {
    const subconditions = compositeKeys.map(([key]) => `LOWER(images.composite) LIKE ?`);
    query += ` AND (${subconditions.join(' OR ')})`;
    params.push(...compositeKeys.map(([key]) => `%${key.toLowerCase()}%`));
  } else {
    // If no matching keys, filter to none
    query += ` AND 0`; // Forces no results
  }
}

  if (req.query.map === 'only') {
    query += ` AND images.mapOverlay = 1`;
  } else if (req.query.map === 'none') {
    query += ` AND images.mapOverlay = 0`;
  }

  if (req.query.search) {
    query += ` AND LOWER(images.path) LIKE ?`;
    params.push(`%${req.query.search.toLowerCase()}%`);
  }

  if (req.query.sort === 'newest') {
    query += ` ORDER BY passes.timestamp DESC`;
  } else if (req.query.sort === 'oldest') {
    query += ` ORDER BY passes.timestamp ASC`;
  } else if (req.query.sort === 'asc') {
    query += ` ORDER BY images.path ASC`;
  } else if (req.query.sort === 'desc') {
    query += ` ORDER BY images.path DESC`;
  }

  const stmt = db.prepare(query);
  const images = stmt.all(...params).map(img => {
    const displayKey = Object.keys(COMPOSITE_TYPES)
    .sort((a, b) => b.length - a.length)
    .find(prefix => img.composite?.toLowerCase().includes(prefix.toLowerCase()));
  
    return {
      ...img,
      compositeDisplay: displayKey ? COMPOSITE_TYPES[displayKey] : (img.composite || 'Unknown')
    };
  });

  res.json(images);
});

router.get('/satellites', (req, res) => {
  const stmt = db.prepare(`
    SELECT DISTINCT passes.satellite
    FROM images
    JOIN passes ON images.passId = passes.id
    WHERE passes.satellite IS NOT NULL
  `);
  const satellites = stmt.all().map(row => row.satellite);
  res.json(satellites);
});

router.get('/composites', (req, res) => {
  res.json(Object.entries(COMPOSITE_TYPES).map(([value, label]) => ({ value, label })));
});

router.get('/export', (req, res) => {
  const filePath = req.query.path;

  if (!filePath || !filePath.endsWith('.cadu')) {
    console.warn(`[EXPORT] Invalid request path: ${filePath}`);
    return res.status(400).send('Invalid file request');
  }

  const absPath = path.join(__dirname, '..', filePath);

  fs.access(absPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.warn(`[EXPORT] File not found: ${absPath}`);
      return res.status(404).send('File not available on site');
    }

    res.download(absPath, (err) => {
      if (err) {
        console.error(`[EXPORT] Error during download:`, err);
        res.status(500).send('Could not download file');
      }
    });
  });
});

router.post('/repopulate', (req, res) => {
  exec('node scripts/db-setup.js --repopulate', (error, stdout, stderr) => {
    if (error) {
      console.error(`Repopulate failed: ${stderr}`);
      return res.status(500).send('Repopulate failed');
    }
    console.log(`Repopulate success: ${stdout}`);
    res.send('Repopulate complete');
  });
});

module.exports = router;