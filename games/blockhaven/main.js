// Blockhaven — an original voxel sandbox. Three.js r160 (vendored), everything else procedural.
import * as THREE from './vendor/three.module.min.js';
import { AIR, WATER, GRASS, SAND, BLOCKS, HOTBAR, isSolid, makeAtlasCanvas, makeIcon } from './blocks.js';
import { World, CS, CH, SEA } from './world.js';

const SAVE_KEY = 'blockhaven.world.v1';
const LAST_KEY = 'blockhaven.create.v1';
const TREE_STEPS = [0, 0.004, 0.012, 0.03];
const TREE_NAMES = ['None', 'Sparse', 'Normal', 'Dense'];
let renderDist = 5;
const DAY_LENGTH = 480; // seconds per full day
const REACH = 6;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- renderer / scene ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('autotest') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 1000);
camera.rotation.order = 'YXZ';
let fogFar = renderDist * CS * 0.95;
scene.fog = new THREE.Fog(0x8ec9ff, fogFar * 0.45, fogFar);
function setRenderDist(n) {
  renderDist = Math.max(2, Math.min(10, n | 0));
  fogFar = renderDist * CS * 0.95;
  scene.fog.near = fogFar * 0.45; scene.fog.far = fogFar;
  camera.far = Math.max(400, renderDist * CS * 3);
  camera.updateProjectionMatrix();
}

const atlasCanvas = makeAtlasCanvas();
const atlas = new THREE.CanvasTexture(atlasCanvas);
atlas.magFilter = THREE.NearestFilter; atlas.minFilter = THREE.NearestFilter; atlas.generateMipmaps = false;
atlas.colorSpace = THREE.SRGBColorSpace;
const materials = {
  solid: new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 }),
  water: new THREE.MeshLambertMaterial({ map: atlas, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
};

const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a4a3a, 0.8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 1.4); scene.add(sun); scene.add(sun.target);
const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xfff0a0, fog: false }));
const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
scene.add(sunMesh, moonMesh);
const starGeo = new THREE.BufferGeometry(); {
  const p = []; for (let i = 0; i < 900; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < -0.1) v.y = -v.y; v.multiplyScalar(450); p.push(v.x, v.y, v.z); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true }));
scene.add(stars);
const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }));
highlight.visible = false; scene.add(highlight);

// ---------- state ----------
let world = null;
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: -0.2, onGround: false, fly: false, inWater: false };
let timeOfDay = 0.08, selected = 0, ready = false, playing = false, lastSave = 0, fps = 0;
const keys = {};
let target = null;

function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } }
function worldSettings(w) {
  return { type: w.type, mode: w.mode, renderDist: w.renderDist, treeDensity: w.treeDensity, sea: w.sea, caves: w.caves, startTime: w.startTime };
}
function optsFromSave(saved) {
  const s = saved && saved.settings ? saved.settings : {};
  return {
    name: (saved && saved.name) || s.name || 'New World',
    type: s.type || 'normal', mode: s.mode || 'survival',
    renderDist: s.renderDist ?? 5, treeDensity: s.treeDensity ?? 0.012,
    sea: s.sea ?? SEA, caves: s.caves ?? false, startTime: s.startTime ?? 0.08,
  };
}
function parseSeed(input) {
  const s = String(input ?? '').trim();
  if (!s) return (Math.random() * 0xFFFFFFFF) >>> 0;
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function save(manual) {
  if (!world || !ready || window.__bhNoSave) return;
  const data = { v: 2, name: world.name, seed: world.seed, settings: worldSettings(world),
    edits: world.editList(), time: timeOfDay, selected, savedAt: Date.now(),
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, fly: player.fly } };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); lastSave = performance.now(); if (manual) toast('World saved ✓'); updateMenu(); }
  catch (e) { toast('Save failed: storage full?'); }
}

function startWorld(seed, saved, opts) {
  opts = opts || optsFromSave(saved);
  if (world) world.clearAll();
  lastCenter = ''; genQueue = [];
  world = new World(scene, materials, seed, opts);
  setRenderDist(world.renderDist);
  if (saved) { world.loadEdits(saved.edits || []); timeOfDay = saved.time ?? world.startTime; selectSlot(saved.selected ?? 0); }
  else { timeOfDay = world.startTime ?? 0.08; }
  // generate around spawn synchronously so we can place the player
  let sx = 0, sz = 0, best = -1;
  if (saved && saved.player) { sx = Math.floor(saved.player.x); sz = Math.floor(saved.player.z); }
  else {
    // spiral out until we find dry land
    outer: for (let r = 0; r < 400; r += 8) for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a / 8 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 8 * Math.PI * 2) * r);
      const h = world.heightAt(x, z);
      if (h > best) { best = h; sx = x; sz = z; }
      if (h > world.sea + 2 && h < 40) { sx = x; sz = z; break outer; }
    }
  }
  const pcx = Math.floor(sx / CS), pcz = Math.floor(sz / CS);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) world.generate(pcx + dx, pcz + dz);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.meshChunk(world.getChunk(pcx + dx, pcz + dz));
  if (saved && saved.player) {
    const p = saved.player; player.pos.set(p.x, p.y, p.z); player.yaw = p.yaw; player.pitch = p.pitch; player.fly = !!p.fly;
  } else {
    // pick a nearby open column whose surface is turf/sand (not a tree top)
    const top = (x, z) => { let y = CH - 1; while (y > 0 && world.getBlock(x, y, z) === AIR) y--; return y; };
    find: for (let r = 0; r < 24; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const b = world.getBlock(sx + dx, top(sx + dx, sz + dz), sz + dz);
      if (b === GRASS || b === SAND) { sx += dx; sz += dz; break find; }
    }
    const y = top(sx, sz);
    player.pos.set(sx + 0.5, y + 1.01, sz + 0.5); player.yaw = 0.6; player.pitch = -0.25;
    player.fly = world.mode === 'creative';
  }
  player.vel.set(0, 0, 0);
  ready = true;
  $('seed').textContent = world.seed;
  $('worldname').textContent = world.name;
  $('gamemode').textContent = world.mode === 'creative' ? 'Creative' : 'Survival';
}

// ---------- chunk streaming ----------
let lastCenter = '', genQueue = [];
function streamChunks(budgetMs) {
  const t0 = performance.now();
  const pcx = Math.floor(player.pos.x / CS), pcz = Math.floor(player.pos.z / CS);
  const center = pcx + ',' + pcz;
  if (center !== lastCenter) {
    lastCenter = center; genQueue = [];
    for (let dz = -renderDist - 1; dz <= renderDist + 1; dz++) for (let dx = -renderDist - 1; dx <= renderDist + 1; dx++) {
      if (dx * dx + dz * dz > (renderDist + 1.5) ** 2) continue;
      genQueue.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    }
    genQueue.sort((a, b) => b[2] - a[2]); // pop() takes nearest
    for (const c of [...world.chunks.values()]) {
      const dx = c.cx - pcx, dz = c.cz - pcz; if (dx * dx + dz * dz > (renderDist + 3) ** 2) world.unload(c);
    }
  }
  while (genQueue.length && performance.now() - t0 < budgetMs) {
    const [cx, cz] = genQueue.pop(); if (!world.getChunk(cx, cz)) world.generate(cx, cz);
  }
  // mesh nearest dirty chunks whose neighbours exist
  const dirty = [];
  for (const c of world.chunks.values()) {
    if (!c.dirty) continue; const dx = c.cx - pcx, dz = c.cz - pcz; const d = dx * dx + dz * dz;
    if (d <= (renderDist + 0.5) ** 2 && world.neighborsReady(c.cx, c.cz)) dirty.push([d, c]);
  }
  dirty.sort((a, b) => a[0] - b[0]);
  for (const [, c] of dirty) { if (performance.now() - t0 > budgetMs * 1.6) break; world.meshChunk(c); }
}

// ---------- physics ----------
const HW = 0.3, PH = 1.8, EYE = 1.62;
function collides(p) {
  for (let y = Math.floor(p.y); y <= Math.floor(p.y + PH - 0.001); y++)
    for (let z = Math.floor(p.z - HW); z <= Math.floor(p.z + HW); z++)
      for (let x = Math.floor(p.x - HW); x <= Math.floor(p.x + HW); x++) {
        if (!world.isLoaded(x, z)) return true;
        if (isSolid(world.getBlock(x, y, z))) return true;
      }
  return false;
}
function moveAxis(axis, delta) {
  const p = player.pos; p[axis] += delta;
  if (!collides(p)) return false;
  if (axis === 'y') { p.y = delta < 0 ? Math.floor(p.y) + 1 : Math.floor(p.y + PH) - PH - 0.001; }
  else if (delta > 0) p[axis] = Math.floor(p[axis] + HW) - HW - 0.001;
  else p[axis] = Math.floor(p[axis] - HW) + 1 + HW + 0.001;
  if (collides(p)) p[axis] -= delta; // safety
  return true;
}
function physics(dt) {
  const p = player, v = p.vel;
  const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = -sin * fwd + cos * str, wz = -cos * fwd - sin * str; const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const feet = world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.2), Math.floor(p.pos.z));
  const chest = world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y + 1.1), Math.floor(p.pos.z));
  p.inWater = feet === WATER || chest === WATER;
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = p.fly ? (sprint ? 16 : 9) : p.inWater ? 3 : sprint ? 6.6 : 4.4;
  const accel = p.fly || p.onGround ? 14 : p.inWater ? 6 : 4;
  const k = 1 - Math.exp(-accel * dt);
  v.x += (wx * speed - v.x) * k; v.z += (wz * speed - v.z) * k;
  if (p.fly) {
    const up = (keys.Space ? 1 : 0) - (keys.KeyC || keys.ControlLeft ? 1 : 0);
    v.y += (up * speed - v.y) * k;
  } else if (p.inWater) {
    v.y -= 9 * dt; v.y = Math.max(v.y, -3);
    if (keys.Space) v.y = Math.min(v.y + 22 * dt, 3.4);
  } else {
    v.y -= 28 * dt; v.y = Math.max(v.y, -50);
    if (keys.Space && p.onGround) { v.y = 8.6; p.onGround = false; }
  }
  // integrate with sub-steps (< 0.4 block each) to avoid tunnelling
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt / 0.4));
  const sdt = dt / steps; p.onGround = false;
  for (let i = 0; i < steps; i++) {
    if (moveAxis('x', v.x * sdt)) v.x = 0;
    if (moveAxis('z', v.z * sdt)) v.z = 0;
    const dy = v.y * sdt;
    if (moveAxis('y', dy)) { if (dy < 0) p.onGround = true; v.y = 0; }
  }
  if (p.pos.y < -20) { p.pos.y = CH + 2; v.set(0, 0, 0); }
}

// ---------- interaction ----------
const _dir = new THREE.Vector3();
function updateTarget() {
  camera.getWorldDirection(_dir);
  target = world.raycast(camera.position, _dir, REACH);
  if (target) { highlight.visible = true; highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5); }
  else highlight.visible = false;
}
function breakBlock() {
  updateTarget(); if (!target) return false;
  if (target.y <= 0) { toast('Deepstone floor is unbreakable'); return false; }
  const ok = world.setBlock(target.x, target.y, target.z, AIR);
  // let water flow into simple holes next to water (one step, keeps it cheap)
  if (ok) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]])
    if (world.getBlock(target.x + dx, target.y + dy, target.z + dz) === WATER) { world.setBlock(target.x, target.y, target.z, WATER); break; }
  updateTarget(); return ok;
}
function placeBlock() {
  updateTarget(); if (!target) return false;
  const x = target.x + target.face[0], y = target.y + target.face[1], z = target.z + target.face[2];
  if (y >= CH || y < 1) return false;
  const cur = world.getBlock(x, y, z); if (cur !== AIR && cur !== WATER) return false;
  const p = player.pos; // don't place inside the player
  if (x + 1 > p.x - HW && x < p.x + HW && z + 1 > p.z - HW && z < p.z + HW && y + 1 > p.y && y < p.y + PH) return false;
  const ok = world.setBlock(x, y, z, HOTBAR[selected]); updateTarget(); return ok;
}

// ---------- UI ----------
const hotbarEl = $('hotbar');
HOTBAR.forEach((id, i) => {
  const s = document.createElement('div'); s.className = 'slot'; s.dataset.i = i;
  const ic = makeIcon(atlasCanvas, id); ic.className = 'icon'; s.appendChild(ic);
  const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1; s.appendChild(n);
  s.title = BLOCKS[id].name; s.addEventListener('click', () => selectSlot(i));
  hotbarEl.appendChild(s);
});
function selectSlot(i) {
  selected = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  hotbarEl.querySelectorAll('.slot').forEach((s, j) => s.classList.toggle('sel', j === selected));
  const nm = $('blockname'); nm.textContent = BLOCKS[HOTBAR[selected]].name; nm.classList.remove('fade'); void nm.offsetWidth; nm.classList.add('fade');
}
selectSlot(0);
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }
function updateMenu() {
  const s = loadSave();
  if (world) {
    $('seed').textContent = world.seed;
    $('worldname').textContent = world.name;
    $('gamemode').textContent = world.mode === 'creative' ? 'Creative' : 'Survival';
  }
  $('saveinfo').textContent = s ? `${s.name || 'Saved world'} · seed ${s.seed} · ${(s.edits || []).length} edited blocks · ${new Date(s.savedAt).toLocaleString()}` : 'No saved world yet — your world autosaves every 20 seconds.';
}
function showMenu(show) { $('menu').classList.toggle('hidden', !show); $('hud').classList.toggle('dim', show); if (show) $('create').classList.add('hidden'); }
function treeIndex(density) {
  let best = 2, d = 1e9;
  for (let i = 0; i < TREE_STEPS.length; i++) { const x = Math.abs(TREE_STEPS[i] - density); if (x < d) { d = x; best = i; } }
  return best;
}
function fillCreateForm(pref) {
  const last = pref || (function () { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } })() || {};
  $('opt-name').value = last.name || 'New World';
  $('opt-seed').value = last.seedText || '';
  $('opt-mode').value = last.mode || 'survival';
  $('opt-type').value = last.type || 'normal';
  $('opt-render').value = String(last.renderDist ?? 5);
  const timeVal = String(last.startTime ?? 0.08);
  const timeEl = $('opt-time');
  timeEl.value = timeVal;
  if (timeEl.value !== timeVal) timeEl.value = '0.08';
  const ti = treeIndex(last.treeDensity ?? 0.012);
  $('opt-trees').value = String(ti); $('tree-label').textContent = TREE_NAMES[ti];
  const sea = last.sea ?? 24;
  $('opt-sea').value = String(sea); $('sea-label').textContent = String(sea);
  $('opt-caves').checked = last.caves !== false;
}
function openCreate(canCancel) {
  fillCreateForm();
  $('btn-create-cancel').classList.toggle('hidden', !canCancel);
  $('menu').classList.add('hidden');
  $('create').classList.remove('hidden');
  $('hud').classList.add('dim');
}
function rememberCreate(settings, seedText) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...settings, seedText: seedText || '' })); } catch {}
}

function lock() { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); }
$('btn-play').onclick = () => { lock(); if (params.has('autotest')) { playing = true; showMenu(false); } };
$('btn-save').onclick = () => save(true);
$('btn-new').onclick = () => openCreate(true);
$('btn-create-cancel').onclick = () => { $('create').classList.add('hidden'); if (ready) showMenu(true); };
$('btn-rand-seed').onclick = () => { $('opt-seed').value = String((Math.random() * 0xFFFFFFFF) >>> 0); };
$('opt-trees').oninput = () => { $('tree-label').textContent = TREE_NAMES[+$('opt-trees').value]; };
$('opt-sea').oninput = () => { $('sea-label').textContent = $('opt-sea').value; };
$('create-form').onsubmit = (e) => {
  e.preventDefault();
  if (loadSave() && ready && !confirm('Create this world? Your saved world will be replaced.')) return;
  const seedText = $('opt-seed').value.trim();
  const opts = {
    name: ($('opt-name').value.trim() || 'New World').slice(0, 32),
    type: $('opt-type').value,
    mode: $('opt-mode').value,
    renderDist: +$('opt-render').value,
    treeDensity: TREE_STEPS[+$('opt-trees').value] ?? 0.012,
    sea: +$('opt-sea').value,
    caves: $('opt-caves').checked,
    startTime: +$('opt-time').value,
  };
  rememberCreate(opts, seedText);
  $('create').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading').textContent = 'Generating world…';
  requestAnimationFrame(() => {
    startWorld(parseSeed(seedText), null, opts);
    save(false);
    $('btn-play').textContent = 'Play';
    updateMenu(); showMenu(true);
    $('loading').classList.add('hidden');
    toast(opts.name + ' created');
  });
};
canvas.addEventListener('click', () => { if (!playing) lock(); });
document.addEventListener('pointerlockchange', () => {
  playing = document.pointerLockElement === canvas;
  showMenu(!playing); $('btn-play').textContent = 'Resume';
  if (!playing) { for (const k in keys) keys[k] = false; save(false); }
});
document.addEventListener('pointerlockerror', () => toast('Pointer lock unavailable — click the game again'));
document.addEventListener('mousemove', (e) => {
  if (!playing) return;
  player.yaw -= e.movementX * 0.0022; player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});
let mouseHeld = -1, repeatT = 0;
document.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (e.button === 0) breakBlock(); else if (e.button === 2) placeBlock(); else if (e.button === 1) pickBlock();
  mouseHeld = e.button; repeatT = 0.3;
});
document.addEventListener('mouseup', () => { mouseHeld = -1; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (playing) selectSlot(selected + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });
function pickBlock() { updateTarget(); if (!target) return; const i = HOTBAR.indexOf(target.block); if (i >= 0) selectSlot(i); }
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) selectSlot(n - 1); }
  if (e.code === 'KeyF' && playing) {
    if (world.mode !== 'creative') toast('Flying is available in Creative mode');
    else { player.fly = !player.fly; player.vel.y = 0; toast(player.fly ? 'Flying on (Space up, C down)' : 'Flying off'); }
  }
  if (e.code === 'KeyK' && playing) save(true);
  if (e.code === 'F3') { e.preventDefault(); $('debug').classList.toggle('hidden'); }
  if (e.code === 'Space' && playing) e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
addEventListener('pagehide', () => save(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) save(false); });

// ---------- day / night ----------
const cDay = new THREE.Color(0x8ec9ff), cNight = new THREE.Color(0x060a1a), cDusk = new THREE.Color(0xf08a4b), sky = new THREE.Color();
const sunDir = new THREE.Vector3();
function updateSky(dt) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  const a = timeOfDay * Math.PI * 2;
  sunDir.set(Math.cos(a), Math.sin(a), 0.35).normalize();
  const h = sunDir.y;
  const day = THREE.MathUtils.smoothstep(h, -0.12, 0.3);
  sky.copy(cNight).lerp(cDay, day);
  const dusk = Math.max(0, 1 - Math.abs(h) / 0.22) * (h > -0.2 ? 1 : 0);
  sky.lerp(cDusk, dusk * 0.45);
  if (player.inWater && world.getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)) === WATER) {
    sky.setHex(0x1d4a8a); scene.fog.near = 1; scene.fog.far = 22;
  } else { scene.fog.near = fogFar * 0.45; scene.fog.far = fogFar; }
  renderer.setClearColor(sky); scene.fog.color.copy(sky);
  sun.intensity = 1.5 * day; hemi.intensity = 0.18 + 0.75 * day;
  hemi.color.setRGB(0.6 + 0.4 * day, 0.65 + 0.35 * day, 0.85 + 0.15 * day);
  sun.position.copy(camera.position).addScaledVector(sunDir, 100); sun.target.position.copy(camera.position);
  sunMesh.position.copy(camera.position).addScaledVector(sunDir, 380); sunMesh.lookAt(camera.position);
  moonMesh.position.copy(camera.position).addScaledVector(sunDir, -380); moonMesh.lookAt(camera.position);
  stars.position.copy(camera.position); stars.material.opacity = 1 - day;
  const hr = Math.floor(((timeOfDay * 24) + 6) % 24), mn = Math.floor((((timeOfDay * 24) + 6) % 1) * 60);
  $('clock').textContent = `${h > 0 ? '☀' : '☾'} ${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

// ---------- loop ----------
let last = performance.now(), frames = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  frames++; fpsT += dt; if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  if (!ready) return;
  streamChunks(playing ? 5 : 12);
  if (playing || params.has('autotest')) physics(dt);
  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
  if (!playing && !params.has('autotest')) player.yaw += dt * 0.03; // gentle pan behind the menu
  updateSky(dt);
  updateTarget();
  if (playing && mouseHeld >= 0) { repeatT -= dt; if (repeatT <= 0) { repeatT = 0.22; if (mouseHeld === 0) breakBlock(); else if (mouseHeld === 2) placeBlock(); } }
  if (playing && now - lastSave > 20000) save(false);
  if (!$('debug').classList.contains('hidden')) {
    const p = player.pos; let tris = 0; for (const c of world.chunks.values()) { if (c.mesh) tris += c.mesh.geometry.index.count / 3; }
    $('debug').textContent = `${fps} fps · xyz ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · chunks ${world.chunks.size} · ${Math.round(tris / 1000)}k tris${player.fly ? ' · flying' : ''}`;
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
const saved = loadSave();
if (saved || params.has('autotest')) {
  const seed = saved ? saved.seed : (params.get('seed') ? parseSeed(params.get('seed')) : (Math.random() * 1e9) >>> 0);
  startWorld(seed, saved);
  if (saved) $('btn-play').textContent = 'Continue World';
  updateMenu(); showMenu(true);
  $('loading').classList.add('hidden');
} else {
  openCreate(false);
  if (params.get('seed')) $('opt-seed').value = params.get('seed');
}
requestAnimationFrame(frame);

// hooks for automated tests
window.__bh = {
  get ready() { return ready; }, player, get world() { return world; }, get target() { updateTarget(); return target; },
  look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z); camera.rotation.set(pitch, yaw, 0); camera.updateMatrixWorld(); },
  breakBlock, placeBlock, selectSlot, save, setTime(t) { timeOfDay = t; }, get fps() { return fps; },
  dirtyCount() { let n = 0; for (const c of world.chunks.values()) if (c.dirty) n++; return n; },
  parseSeed, startWorld, openCreate,
};
