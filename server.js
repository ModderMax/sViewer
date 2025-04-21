const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');
const statsHandler = require('./routes/stats');
const appStartTime = Date.now();
const updateRoute = require('./routes/update');
const lhmRoute = require('./routes/hm');
const userControls = require('./routes/userControls');

require('./scripts/db-setup')('--update');

const app = express();
const PORT = 1500;

// Use json format for incoming requests
app.use(express.json());

let lastUpdateTime = 0;
const UPDATE_COOLDOWN_MS = 60 * 1000; // 1 minute update cooldown

function shouldUpdate() {
  return Date.now() - lastUpdateTime > UPDATE_COOLDOWN_MS;
}

function markUpdated() {
  lastUpdateTime = Date.now();
}

module.exports = { shouldUpdate, markUpdated };

// Serve static files from public
app.use(express.static(path.join(__dirname, 'public')));

app.use('/css', express.static(path.join(__dirname, 'public/css'), { setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
        res.set('Content-Type', 'text/css');
    }
} }));

// Serve image files
app.use('/images', express.static(path.join(__dirname, 'live_output')));

// Route for API
app.use('/api', apiRoutes);

// Route for hardwaremonitor proxy to bypass CORS
app.use('/api/hm', lhmRoute);

// Route for interval updates and request limiting
app.use('/api/update', updateRoute);

// Route for server info
app.get('/api/stats', statsHandler(appStartTime));

// Route for modifying user-defined data
app.use('/api/userControls', userControls);

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/gallery', (req, res) => res.sendFile(path.join(__dirname, 'public/gallery.html')));
app.get('/satdump', (req, res) => res.sendFile(path.join(__dirname, 'public/satdump.html')));
app.get('/stats', (req, res) => res.sendFile(path.join(__dirname, 'public/stats.html')));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
