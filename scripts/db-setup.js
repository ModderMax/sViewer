const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'image_metadata.db');
const liveOutputDir = path.join(__dirname, '..', 'live_output');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const db = new Database(dbPath);

// Setup DB schema
function initializeDatabase() {
  const passCols = db.prepare(`PRAGMA table_info(passes)`).all().map(c => c.name);
  if (!passCols.includes('satellite')) {
    db.exec(`DROP TABLE IF EXISTS passes`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS passes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      satellite TEXT,
      timestamp INTEGER,
      rawDataPath TEXT
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT,
      composite TEXT,
      mapOverlay INTEGER,
      corrected INTEGER,
      filled INTEGER,
      passId INTEGER,
      FOREIGN KEY (passId) REFERENCES passes(id)
    );
  `);
}

// Clear tables before repopulating
function clearTables() {
  db.exec(`DELETE FROM images;`);
  db.exec(`DELETE FROM passes;`);
}

function isImageFile(name) {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
}

function isDirectoryStable(dirPath) {
  const maxDirAgeMs = 15 * 60 * 1000
  const recentFileThresholdMs = 4 * 60 * 1000
  try {
    const dirStat = fs.statSync(dirPath);
    const now = Date.now();
    const dirAge = now - dirStat.mtimeMs;

    // If directory is older than 15 mins, assume stable
    if (dirAge > maxDirAgeMs) return true;

    // Recursively check all files
    const noRecentFiles = isFileSystemStable(dirPath, now, recentFileThresholdMs);
    return noRecentFiles;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Directory does not exist yet: ${dirPath}`);
    } else {
      console.error(`Failed to stat directory ${dirPath}:`, err.message);
    }
    return false;
  }
}

function isFileSystemStable(dir, now, thresholdMs) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Unable to read directory ${dir}: ${err.message}`);
    return false;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    try {
      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;
      const fileAge = now - mtime;
      if (entry.isFile()) {
        if (fileAge < thresholdMs) {
          return false; // yung file found
        }
      } else if (entry.isDirectory()) {
        if (fileAge < thresholdMs) {
          return false; // yung dir found
        }
        if (!isFileSystemStable(fullPath, now, thresholdMs)) {
          return false; // recurring found yung file / dir
        }
      }
    } catch (err) {
      console.warn(`big RIP cuz ${fullPath}: ${err.message} happened`);
    }
  }
  return true;
}

function processNOAAPass(passPath, passName, dataset) {
  const images = fs.readdirSync(passPath).filter(isImageFile);
  return images.map(file => ({
    path: `/images/${passName}/${file}`,
    composite: path.parse(file).name.toLowerCase(),
    corrected: 1,
    filled: 0,
    mapOverlay: file.toLowerCase().includes('map'),
  }));
}

function processMeteorPass(passPath, passName, dataset) {
  const subdirs = ['MSU-MR', 'MSU-MR (Filled)'];
  let results = [];
  for (const subdir of subdirs) {
    const fullSubdir = path.join(passPath, subdir);
    if (!fs.existsSync(fullSubdir)) continue;
    const images = fs.readdirSync(fullSubdir).filter(isImageFile);
    for (const file of images) {
      results.push({
        path: `/images/${passName}/${subdir}/${file}`,
        composite: path.parse(file).name.toLowerCase(),
        corrected: file.toLowerCase().includes('corrected'),
        filled: subdir.toLowerCase().includes('filled') ? 1 : 0,
        mapOverlay: file.toLowerCase().includes('map'),
      });
    }
  }
  return results;
}

function processElektroPass(passPath, passName, cacheData) {
  const elektroRoot = path.join(passPath, 'IMAGES', 'ELEKTRO-L3');
  if (!fs.existsSync(elektroRoot)) return [];

  const results = [];
  for (const subfolder of fs.readdirSync(elektroRoot)) {
    const fullFolder = path.join(elektroRoot, subfolder);
    const images = fs.readdirSync(fullFolder).filter(isImageFile);
    const timestamp = cacheData?.[`IMAGES/ELEKTRO-L3/${subfolder}`]?.time || null;

    for (const file of images) {
      results.push({
        path: `/images/${passName}/IMAGES/ELEKTRO-L3/${subfolder}/${file}`,
        composite: path.parse(file).name.toLowerCase(),
        corrected: 1,
        mapOverlay: file.toLowerCase().includes('map'),
        timestamp
      });
    }
  }
  return results;
}

function processSVISSRPass(passPath, passName) {
  const svissrRoot = path.join(passPath, 'IMAGE');
  if (!fs.existsSync(svissrRoot)) return [];

  const results = [];
  for (const subfolder of fs.readdirSync(svissrRoot)) {
    const fullFolder = path.join(svissrRoot, subfolder);
    const images = fs.readdirSync(fullFolder).filter(isImageFile);
    for (const file of images) {
      results.push({
        path: `/images/${passName}/IMAGE/${subfolder}/${file}`,
        composite: path.parse(file).name.toLowerCase(),
        corrected: 1,
        mapOverlay: file.toLowerCase().includes('map'),
      });
    }
  }
  return results;
}

function processPass(passFolder)
{
  const insertPass = db.prepare(`
    INSERT INTO passes (name, satellite, timestamp, rawDataPath)
    VALUES (?, ?, ?, ?)
  `);

  const insertImage = db.prepare(`
    INSERT INTO images (path, composite, mapOverlay, corrected, filled, passId)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const passPath = path.join(liveOutputDir, passFolder);
  const datasetPath = path.join(passPath, 'dataset.json');
  const cachePath = path.join(passPath, '.composite_cache_do_not_delete.json');

  let rawDataPath = null;
  let satellite = 'Unknown';
  let timestamp = null;
  let images = [];

  if (fs.existsSync(datasetPath)) {
    const dataset = JSON.parse(fs.readFileSync(datasetPath));
    satellite = dataset.satellite || satellite;
    timestamp = Math.floor(dataset.timestamp || 0);

    if (satellite.toLowerCase().includes('noaa')) {
      images = processNOAAPass(passPath, passFolder, dataset);
      rawDataPath = 0;
    } 
    else if (satellite.toLowerCase().includes('meteor')) {
      images = processMeteorPass(passPath, passFolder, dataset);
      const files = fs.readdirSync(passPath);
      const caduFile = files.find(file => file.toLowerCase().endsWith('.cadu'));
      if (caduFile) {
        rawDataPath = path.join('live_output', passFolder, caduFile);
      }
    }
  } 
  else if (fs.existsSync(cachePath)) {
    const cacheData = JSON.parse(fs.readFileSync(cachePath));
    satellite = 'Elektro-L3';
    timestamp = Object.values(cacheData)[0]?.time || null;
    images = processElektroPass(passPath, passFolder, cacheData);
    rawDataPath = 0;
  } else if (fs.existsSync(path.join(passPath, 'IMAGE'))) {
    satellite = 'FengYun';
    images = processSVISSRPass(passPath, passFolder);
    rawDataPath = 0;
  }

  const result = insertPass.run(passFolder, satellite, timestamp, rawDataPath);
  const passId = result.lastInsertRowid;

  images.forEach(img =>
    insertImage.run(
      img.path,
      img.composite,
      img.mapOverlay ? 1 : 0,
      img.corrected ? 1 : 0,
      img.filled ? 1 : 0,
      passId
    )
  );
}

function runSetup(mode) {
  let addedCount = 0;
  const passFolders = fs.readdirSync(liveOutputDir).filter(folder => {
    const fullPath = path.join(liveOutputDir, folder);
    return fs.statSync(fullPath).isDirectory();
  });
  if (mode === '--update') {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='passes'`).get();
    if (!tableExists) {
      console.log('Table "passes" does not exist. Falling back to --repopulate.');
      return runSetup('--repopulate');
    }
    const passExists = db.prepare('SELECT 1 FROM passes WHERE name = ?');
    for (const passFolder of passFolders) {
      if (!isDirectoryStable(path.join(liveOutputDir, passFolder))) {
        console.log(passFolder, 'may be updating at this time; skipping...')
        continue; // Skip if already exists
      }
      if (passExists.get(passFolder)) {
        continue; // Skip if already exists
      }
      processPass(passFolder);
      addedCount++;
    }
    console.log('Database has been updated. Added ', addedCount, ' passes');
  }
  if (mode === '--repopulate') {
    initializeDatabase();
    clearTables();
    for (const passFolder of fs.readdirSync(liveOutputDir)) {
      if (!fs.statSync(path.join(liveOutputDir, passFolder)).isDirectory()) continue;
      processPass(passFolder);
      addedCount++;
    }
    console.log('Database population complete. Passes found:', addedCount);
  }
  if (mode === '--rebuild') {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Deleted existing database.');
    }
    initializeDatabase();
    console.log('Database initialized');
    for (const passFolder of fs.readdirSync(liveOutputDir)) {
      if (!fs.statSync(path.join(liveOutputDir, passFolder)).isDirectory()) continue;
      processPass(passFolder);
      addedCount++;
    }
    console.log('Database population complete. Passes found:', addedCount);
  }
}

module.exports = runSetup;

if (require.main === module) {
  runSetup(process.argv[2]);
}