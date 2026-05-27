const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const { exec } = require('child_process');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const GEO_CACHE = new Map();
const TRACEROUTE_INTERVAL_MS = 15000; // run traceroute every 15 seconds

async function getGeoForIP(ip) {
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { lat: -27.4679, lon: 153.0281, city: 'Local Network', country: 'AU', org: 'Private' };
  }
  if (GEO_CACHE.has(ip)) return GEO_CACHE.get(ip);

  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`);
    const data = await res.json();
    if (data.loc) {
      const [lat, lon] = data.loc.split(',').map(Number);
      const geo = { lat, lon, city: data.city || '', region: data.region || '', country: data.country || '', org: data.org || '' };
      GEO_CACHE.set(ip, geo);
      return geo;
    }
  } catch (e) {
    // silent fallback
  }
  return null;
}

function runTraceroute(target = '1.1.1.1') {
  return new Promise((resolve) => {
    const cmd = `traceroute -m 30 -w 3 ${target}`;
    exec(cmd, { timeout: 45000 }, async (error, stdout, stderr) => {
      const lines = stdout.split('\n').filter(l => l.trim());
      const hops = [];
      let currentHopNum = 0;

      for (const line of lines) {
        // Main hop line: starts with a number
        const mainMatch = line.match(/^\s*(\d+)\s+(.+)$/);
        if (mainMatch && !isNaN(parseInt(mainMatch[1], 10))) {
          currentHopNum = parseInt(mainMatch[1], 10);
          const rest = mainMatch[2];

          const ipMatch = rest.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
          const hostMatch = rest.match(/^([^\s(]+)/);
          const latencyMatches = rest.match(/([\d.]+)\s+ms/g);

          const ip = ipMatch ? ipMatch[1] : (hostMatch ? hostMatch[1] : null);
          const host = hostMatch ? hostMatch[1] : (ip || 'unknown');
          const latencies = latencyMatches
            ? latencyMatches.map(m => parseFloat(m.replace('ms', '').trim()))
            : [];

          if (ip && ip !== '*') {
            const geo = await getGeoForIP(ip);
            const avgLatency = latencies.length
              ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
              : null;
            hops.push({ hop: currentHopNum, host, ip, latencies, avgLatency, geo });
          }
          continue;
        }

        // Indented continuation line (macOS traceroute multi-IP format)
        const indentMatch = line.match(/^\s+([^\s(]+)\s*\((\d+\.\d+\.\d+\.\d+)\)\s+(.+)$/);
        if (indentMatch && currentHopNum > 0) {
          const host = indentMatch[1];
          const ip = indentMatch[2];
          const rest = indentMatch[3];
          const latencyMatches = rest.match(/([\d.]+)\s+ms/g);
          const latencies = latencyMatches
            ? latencyMatches.map(m => parseFloat(m.replace('ms', '').trim()))
            : [];

          if (ip && ip !== '*') {
            const geo = await getGeoForIP(ip);
            const avgLatency = latencies.length
              ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
              : null;
            hops.push({ hop: currentHopNum, host, ip, latencies, avgLatency, geo });
          }
        }
      }

      resolve(hops);
    });
  });
}

async function broadcastTraceroute() {
  const hops = await runTraceroute('1.1.1.1');
  io.emit('traceroute', { timestamp: Date.now(), hops });
}

io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);
  // Send initial data immediately
  const hops = await runTraceroute('1.1.1.1');
  socket.emit('traceroute', { timestamp: Date.now(), hops });

  // Handle on-demand traceroute requests from the client
  socket.on('request-traceroute', async ({ target }) => {
    const t = (target || '1.1.1.1').trim();
    // Basic sanitization: only allow IPs and simple hostnames
    if (!/^[\w.\-:]+$/.test(t)) {
      socket.emit('traceroute', { timestamp: Date.now(), hops: [], error: 'Invalid target' });
      return;
    }
    console.log(`On-demand traceroute to ${t} for ${socket.id}`);
    const hops = await runTraceroute(t);
    socket.emit('traceroute', { timestamp: Date.now(), hops });
  });
});

// Start periodic traceroute
setInterval(broadcastTraceroute, TRACEROUTE_INTERVAL_MS);
// Initial run after 2 seconds
setTimeout(broadcastTraceroute, 2000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Globe Traceroute server running on http://localhost:${PORT}`);
});
