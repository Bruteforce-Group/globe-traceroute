/**
 * Globe Traceroute — Real-Time 3D Visualization
 * Renders a textured Earth with animated hop markers and connection arcs.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const socket = io();
let globeScene, globeCamera, globeRenderer, controls;
let earthMesh, earthGroup;
let hopMarkers = [];
let arcLines = [];
let particleSystems = [];
let currentHops = [];

const EARTH_RADIUS = 100;
const MARKER_RADIUS = 1.8;
const ARC_HEIGHT_FACTOR = 0.25;

init();

function init() {
  const container = document.getElementById('globe-container');

  // Scene
  globeScene = new THREE.Scene();

  // Camera
  globeCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
  globeCamera.position.set(0, 80, 320);

  // Renderer
  globeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  globeRenderer.setSize(window.innerWidth, window.innerHeight);
  globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  globeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(globeRenderer.domElement);

  // Controls
  controls = new OrbitControls(globeCamera, globeRenderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 150;
  controls.maxDistance = 600;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  globeScene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunLight.position.set(200, 100, 200);
  globeScene.add(sunLight);

  const backLight = new THREE.DirectionalLight(0x4455aa, 0.4);
  backLight.position.set(-200, -50, -200);
  globeScene.add(backLight);

  // Stars
  createStars();

  // Earth
  createEarth();

  // Animation loop
  animate();

  // Resize
  window.addEventListener('resize', onWindowResize);
}

function createStars() {
  const starGeometry = new THREE.BufferGeometry();
  const starCount = 6000;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    const r = 800 + Math.random() * 400;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
  });

  globeScene.add(new THREE.Points(starGeometry, starMaterial));
}

function createEarth() {
  earthGroup = new THREE.Group();
  globeScene.add(earthGroup);

  const textureLoader = new THREE.TextureLoader();

  // Use NASA Blue Marble texture from Wikimedia (reliable CDN)
  const earthTexture = textureLoader.load(
    'https://upload.wikimedia.org/wikipedia/commons/c/c4/Earthmap1000x500.jpg',
    () => { globeRenderer.render(globeScene, globeCamera); }
  );

  const earthMaterial = new THREE.MeshPhongMaterial({
    map: earthTexture,
    shininess: 10,
    specular: new THREE.Color(0x111111)
  });

  const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
  earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
  earthGroup.add(earthMesh);

  // Atmosphere glow
  const atmosGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.04, 64, 64);
  const atmosMaterial = new THREE.MeshBasicMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  earthGroup.add(new THREE.Mesh(atmosGeometry, atmosMaterial));
}

// Convert lat/lon to 3D position on sphere surface
function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function getHopColor(avgLatency, isDestination) {
  if (isDestination) return new THREE.Color(0x79c0ff);
  if (!avgLatency || avgLatency < 60) return new THREE.Color(0x7ee787);
  if (avgLatency < 120) return new THREE.Color(0xffa657);
  return new THREE.Color(0xf85149);
}

function clearHops() {
  hopMarkers.forEach(m => earthGroup.remove(m));
  arcLines.forEach(a => earthGroup.remove(a));
  particleSystems.forEach(p => earthGroup.remove(p));

  hopMarkers = [];
  arcLines = [];
  particleSystems = [];
}

function updateHops(hops) {
  clearHops();
  currentHops = hops;

  const positions = [];

  hops.forEach((hop, index) => {
    if (!hop.geo || hop.geo.lat === null) return;

    const pos = latLonToVector3(hop.geo.lat, hop.geo.lon, EARTH_RADIUS);
    positions.push(pos);

    // Marker
    const isDestination = index === hops.length - 1;
    const color = getHopColor(hop.avgLatency, isDestination);

    const markerGeo = new THREE.SphereGeometry(MARKER_RADIUS, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(pos);
    earthGroup.add(marker);
    hopMarkers.push(marker);

    // Pulse ring around marker
    const ringGeo = new THREE.RingGeometry(MARKER_RADIUS * 1.5, MARKER_RADIUS * 2.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    earthGroup.add(ring);
    hopMarkers.push(ring);

    // Animate ring scale
    ring.userData = { baseScale: 1, phase: index * 0.5 };
  });

  // Draw arcs between consecutive hops
  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i];
    const end = positions[i + 1];
    createArc(start, end, i);
  }

  // Draw data particles flowing along arcs
  for (let i = 0; i < positions.length - 1; i++) {
    createParticleFlow(positions[i], positions[i + 1], i);
  }

  updateInfoPanel(hops);
}

function createArc(start, end, index) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const dist = start.distanceTo(end);
  mid.normalize().multiplyScalar(EARTH_RADIUS + dist * ARC_HEIGHT_FACTOR);

  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  const points = curve.getPoints(80);

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25 + (index * 0.02)
  });

  const line = new THREE.Line(geometry, material);
  earthGroup.add(line);
  arcLines.push(line);
}

function createParticleFlow(start, end, index) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const dist = start.distanceTo(end);
  mid.normalize().multiplyScalar(EARTH_RADIUS + dist * ARC_HEIGHT_FACTOR);

  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  const particleCount = 8;
  const particles = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const t = i / particleCount;
    const point = curve.getPoint(t);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
  }

  particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffaa44,
    size: 2.5,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending
  });

  const pointsMesh = new THREE.Points(particles, material);
  pointsMesh.userData = { curve, speed: 0.004 + index * 0.001 };
  earthGroup.add(pointsMesh);
  particleSystems.push(pointsMesh);
}

function updateInfoPanel(hops) {
  const list = document.getElementById('hop-list');
  list.innerHTML = '';

  hops.forEach((hop, i) => {
    const li = document.createElement('li');
    const latStr = hop.geo ? `${hop.geo.lat.toFixed(2)}, ${hop.geo.lon.toFixed(2)}` : 'unknown';
    const locStr = hop.geo && hop.geo.city ? `${hop.geo.city}, ${hop.geo.country}` : '';
    const latColor = hop.avgLatency && hop.avgLatency > 120 ? '#f85149' : (hop.avgLatency && hop.avgLatency > 60 ? '#ffa657' : '#7ee787');

    li.innerHTML = `
      <span class="hop-num">${String(hop.hop).padStart(2, '0')}</span>
      <span class="hop-lat" style="color:${latColor}">${hop.avgLatency ? hop.avgLatency + 'ms' : '—'}</span>
      <span class="hop-loc">${locStr || hop.host}</span>
      <br><span class="hop-ip">${hop.ip} ${latStr !== 'unknown' ? '(' + latStr + ')' : ''}</span>
    `;
    list.appendChild(li);
  });

  document.getElementById('status').textContent =
    `Last updated: ${new Date().toLocaleTimeString()} · ${hops.length} hops mapped`;
}

function animateParticles() {
  if (!particlesEnabled) return;
  particleSystems.forEach(sys => {
    const positions = sys.geometry.attributes.position.array;
    const curve = sys.userData.curve;
    const speed = sys.userData.speed;

    for (let i = 0; i < positions.length / 3; i++) {
      let t = (Date.now() * speed + i / (positions.length / 3)) % 1;
      const point = curve.getPoint(t);
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    }

    sys.geometry.attributes.position.needsUpdate = true;
  });
}

function animateRings() {
  const time = Date.now() * 0.003;
  hopMarkers.forEach(m => {
    if (m.userData && m.userData.baseScale) {
      const scale = 1 + Math.sin(time + m.userData.phase) * 0.3;
      m.scale.set(scale, scale, scale);
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  animateParticles();
  animateRings();
  globeRenderer.render(globeScene, globeCamera);
}

function onWindowResize() {
  globeCamera.aspect = window.innerWidth / window.innerHeight;
  globeCamera.updateProjectionMatrix();
  globeRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── LATENCY HISTORY & CHART ───
const MAX_HISTORY = 40;
const latencyHistory = []; // Array of { timestamp, hops: [{ hop, avgLatency }] }

function addHistorySnapshot(hops) {
  latencyHistory.push({ timestamp: Date.now(), hops: hops.map(h => ({ hop: h.hop, avgLatency: h.avgLatency })) });
  if (latencyHistory.length > MAX_HISTORY) latencyHistory.shift();
  drawChart();
}

function drawChart() {
  const canvas = document.getElementById('latency-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  if (latencyHistory.length < 2) return;

  // Determine hop keys (max 7 colors)
  const hopKeys = [...new Set(latencyHistory.flatMap(s => s.hops.map(h => h.hop)))].sort((a, b) => a - b);
  const colors = ['#7ee787','#ffa657','#f85149','#79c0ff','#d2a8ff','#ff7b72','#56d4dd'];

  // Y range
  let maxLat = 0;
  latencyHistory.forEach(s => s.hops.forEach(h => { if (h.avgLatency && h.avgLatency > maxLat) maxLat = h.avgLatency; }));
  if (maxLat < 50) maxLat = 50;
  maxLat *= 1.15;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = h - (i / 4) * (h - 16);
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '9px SF Mono, monospace';
    ctx.fillText(Math.round((i / 4) * maxLat) + 'ms', 0, y + 3);
  }

  // Draw per-hop line
  hopKeys.forEach((hopNum, ci) => {
    const color = colors[ci % colors.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let first = true;
    latencyHistory.forEach((snap, si) => {
      const hh = snap.hops.find(h => h.hop === hopNum);
      if (!hh || !hh.avgLatency) return;
      const x = 30 + (si / (latencyHistory.length - 1)) * (w - 40);
      const y = h - (hh.avgLatency / maxLat) * (h - 16);
      if (first) { ctx.moveTo(x, y); first = false; }
      else { ctx.lineTo(x, y); }
    });
    ctx.stroke();
  });
}

// ─── QUALITY BAR ───
function updateQualityBar(hops) {
  const latencies = hops.map(h => h.avgLatency).filter(v => v != null);
  const hopCount = hops.length;

  if (latencies.length === 0) return;

  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const jitter = latencies.length > 1
    ? Math.round(Math.sqrt(latencies.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (latencies.length - 1)))
    : 0;

  document.getElementById('q-loss').textContent = '0%';
  document.getElementById('q-loss').style.color = '#7ee787';
  document.getElementById('q-lat').textContent = avg + 'ms';
  document.getElementById('q-lat').style.color = avg < 80 ? '#7ee787' : (avg < 150 ? '#ffa657' : '#f85149');
  document.getElementById('q-jitter').textContent = jitter + 'ms';
  document.getElementById('q-jitter').style.color = jitter < 40 ? '#7ee787' : (jitter < 80 ? '#ffa657' : '#f85149');
  document.getElementById('q-hops').textContent = hopCount;
  document.getElementById('q-hops').style.color = '#79c0ff';
}

// ─── EXPORT DATA ───
function exportJSON() {
  if (latencyHistory.length === 0) return;
  const blob = new Blob([JSON.stringify(latencyHistory, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `traceroute-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  if (latencyHistory.length === 0) return;
  const hopKeys = [...new Set(latencyHistory.flatMap(s => s.hops.map(h => h.hop)))].sort((a, b) => a - b);
  let csv = 'timestamp,' + hopKeys.map(h => 'hop' + h + '_ms').join(',') + '\n';
  latencyHistory.forEach(s => {
    const row = [new Date(s.timestamp).toISOString()];
    hopKeys.forEach(k => {
      const h = s.hops.find(x => x.hop === k);
      row.push(h && h.avgLatency != null ? h.avgLatency : '');
    });
    csv += row.join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `traceroute-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── UI CONTROLS ───
let particlesEnabled = true;

function toggleParticles() {
  particlesEnabled = document.getElementById('chk-particles').checked;
}

function toggleAutoRotate() {
  controls.autoRotate = document.getElementById('chk-rotate').checked;
}

function refreshTraceroute() {
  const target = document.getElementById('target-input').value.trim() || '1.1.1.1';
  socket.emit('request-traceroute', { target });
  document.getElementById('status').textContent = 'Running traceroute to ' + target + '...';
}

function resetView() {
  controls.reset();
  globeCamera.position.set(0, 80, 320);
}

function zoomToHops() {
  if (currentHops.length === 0) return;
  const geoHops = currentHops.filter(h => h.geo);
  if (geoHops.length === 0) return;

  // Compute bounding center
  let avgLat = 0, avgLon = 0;
  geoHops.forEach(h => { avgLat += h.geo.lat; avgLon += h.geo.lon; });
  avgLat /= geoHops.length;
  avgLon /= geoHops.length;

  const center = latLonToVector3(avgLat, avgLon, EARTH_RADIUS * 2.5);
  globeCamera.position.copy(center);
  globeCamera.lookAt(0, 0, 0);
}

// Toggle panel visibility
function togglePanel(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}

// Event bindings
document.getElementById('btn-refresh')?.addEventListener('click', refreshTraceroute);
document.getElementById('btn-export-json')?.addEventListener('click', exportJSON);
document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
document.getElementById('chk-rotate')?.addEventListener('change', toggleAutoRotate);
document.getElementById('chk-particles')?.addEventListener('change', toggleParticles);
document.getElementById('btn-zoom')?.addEventListener('click', zoomToHops);
document.getElementById('btn-reset')?.addEventListener('click', resetView);
document.getElementById('btn-toggle-info')?.addEventListener('click', () => togglePanel('info-panel'));
document.getElementById('btn-toggle-chart')?.addEventListener('click', () => togglePanel('chart-panel'));

// Target input: press Enter to refresh
document.getElementById('target-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') refreshTraceroute();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key.toLowerCase()) {
    case 'r': refreshTraceroute(); break;
    case 't':
      document.getElementById('chk-rotate').checked = !document.getElementById('chk-rotate').checked;
      toggleAutoRotate();
      break;
    case 'z': zoomToHops(); break;
    case '1': togglePanel('info-panel'); break;
    case '2': togglePanel('legend'); break;
    case '3': togglePanel('chart-panel'); break;
    case '?':
      alert('Shortcuts:\nR = refresh traceroute\nT = toggle auto-rotate\nZ = zoom to hops\n1 = toggle info panel\n2 = toggle legend\n3 = toggle chart panel\n? = this help');
      break;
  }
});

// ─── SERVER SUPPORT FOR ON-DEMAND TRACEROUTE ───
socket.on('connect', () => {
  document.getElementById('status').textContent = 'Connected — waiting for traceroute data...';
});

socket.on('traceroute', (data) => {
  updateHops(data.hops);
  addHistorySnapshot(data.hops);
  updateQualityBar(data.hops);
});

socket.on('disconnect', () => {
  document.getElementById('status').textContent = 'Disconnected — reconnecting...';
});
