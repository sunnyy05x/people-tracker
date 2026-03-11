/* =============================================
   People Tracker — Unified Server
   =============================================
   Single server that:
   1. Serves the camera app (built by Vite) at /camera
   2. Serves the public dashboard at /
   3. Handles WebSocket relay between camera and dashboards
   ============================================= */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const PORT = 4000;

// ── Serve camera app (built Vite output) at /camera ─
app.use('/camera', express.static(join(__dirname, 'dist')));

// ── Serve dashboard at / ────────────────────────
app.use('/', express.static(join(__dirname, 'dashboard')));

// ── WebSocket Server ────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

// Store the latest state so new viewers get it immediately
let latestStats = {
  count: 0,
  peak: 0,
  fps: 0,
  avgConfidence: 0,
  timestamp: Date.now(),
  cameraConnected: false,
};

let cameraClient = null;
const dashboardClients = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const role = url.searchParams.get('role');

  if (role === 'camera') {
    // ── Camera client (the phone) ─────────────────
    console.log('📷 Camera client connected');
    cameraClient = ws;
    latestStats.cameraConnected = true;
    broadcastToDashboards();

    ws.on('message', (data) => {
      try {
        const stats = JSON.parse(data.toString());
        latestStats = { ...stats, cameraConnected: true, timestamp: Date.now() };
        broadcastToDashboards();
      } catch (e) {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      console.log('📷 Camera client disconnected');
      cameraClient = null;
      latestStats.cameraConnected = false;
      broadcastToDashboards();
    });
  } else {
    // ── Dashboard viewer ──────────────────────────
    console.log('📊 Dashboard viewer connected');
    dashboardClients.add(ws);

    // Send the latest state immediately
    ws.send(JSON.stringify(latestStats));

    ws.on('close', () => {
      dashboardClients.delete(ws);
      console.log('📊 Dashboard viewer disconnected');
    });
  }
});

function broadcastToDashboards() {
  const payload = JSON.stringify(latestStats);
  for (const client of dashboardClients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

// ── Start ───────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🟢  People Tracker — Unified Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  📊 Dashboard:  http://localhost:${PORT}/`);
  console.log(`  📷 Camera App: http://localhost:${PORT}/camera/`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Run localtunnel to get a public URL:');
  console.log(`  npx localtunnel --port ${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
