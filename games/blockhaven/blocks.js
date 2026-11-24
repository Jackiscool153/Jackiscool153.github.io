// Block definitions + procedurally generated texture atlas (no external assets).
export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WATER = 5, LOG = 6, LEAVES = 7,
  PLANKS = 8, GLASS = 9, BRICK = 10, COBBLE = 11, SNOW = 12, DEEPSTONE = 13;

// tiles: index into a 4x4 atlas
const T = { grassTop: 0, grassSide: 1, dirt: 2, stone: 3, sand: 4, water: 5, logSide: 6, logTop: 7,
  leaves: 8, planks: 9, glass: 10, brick: 11, cobble: 12, snow: 13, snowSide: 14, deep: 15 };

// kind: 0 = opaque, 1 = cutout (alpha-tested), 2 = water (translucent)
export const BLOCKS = [];
function def(id, name, top, side, bottom, kind = 0) { BLOCKS[id] = { id, name, top, side, bottom, kind }; }
def(AIR, 'Air', 0, 0, 0, -1);
def(GRASS, 'Meadow Turf', T.grassTop, T.grassSide, T.dirt);
def(DIRT, 'Soil', T.dirt, T.dirt, T.dirt);
def(STONE, 'Stone', T.stone, T.stone, T.stone);
def(SAND, 'Sand', T.sand, T.sand, T.sand);
def(WATER, 'Water', T.water, T.water, T.water, 2);
def(LOG, 'Timber Log', T.logTop, T.logSide, T.logTop);
def(LEAVES, 'Foliage', T.leaves, T.leaves, T.leaves, 1);
def(PLANKS, 'Planks', T.planks, T.planks, T.planks);
def(GLASS, 'Glass', T.glass, T.glass, T.glass, 1);
def(BRICK, 'Clay Brick', T.brick, T.brick, T.brick);
def(COBBLE, 'Rubble Stone', T.cobble, T.cobble, T.cobble);
def(SNOW, 'Snow', T.snow, T.snowSide, T.dirt);
def(DEEPSTONE, 'Deepstone', T.deep, T.deep, T.deep);

export const KIND = new Int8Array(256).fill(-1);
for (const b of BLOCKS) if (b) KIND[b.id] = b.kind;
export const isOpaque = (b) => KIND[b] === 0;
export const isSolid = (b) => b !== AIR && b !== WATER;

export const HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, LEAVES, GLASS, BRICK];

export const TILE = 16, ATLAS_TILES = 4;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeAtlasCanvas() {
  const size = TILE * ATLAS_TILES;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const rnd = mulberry32(1337);
  const set = (tile, x, y, r, g, b, a = 255) => {
    const ox = (tile % ATLAS_TILES) * TILE, oy = Math.floor(tile / ATLAS_TILES) * TILE;
    const i = ((oy + y) * size + ox + x) * 4;
    px[i] = Math.max(0, Math.min(255, r)); px[i + 1] = Math.max(0, Math.min(255, g)); px[i + 2] = Math.max(0, Math.min(255, b)); px[i + 3] = a;
  };
  const speck = (tile, [r, g, b], v, fn) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const n = (rnd() - 0.5) * v; let c = [r + n, g + n, b + n, 255];
      if (fn) c = fn(x, y, c) || c;
      set(tile, x, y, c[0], c[1], c[2], c[3]);
    }
  };
  const dirtCol = [134, 96, 67];
  speck(T.grassTop, [92, 160, 60], 40, (x, y, c) => (rnd() < 0.08 ? [c[0] + 25, c[1] + 30, c[2] + 10, 255] : c));
  speck(T.dirt, dirtCol, 36, (x, y, c) => (rnd() < 0.07 ? [c[0] - 30, c[1] - 25, c[2] - 20, 255] : c));
  const fringe = []; for (let x = 0; x < TILE; x++) fringe[x] = 3 + Math.floor(rnd() * 3);
  speck(T.grassSide, dirtCol, 36, (x, y, c) => (y < fringe[x] ? [92 + (rnd() - 0.5) * 40, 160 + (rnd() - 0.5) * 40, 60, 255] : c));
  speck(T.stone, [128, 128, 130], 30, (x, y, c) => (rnd() < 0.1 ? [c[0] - 25, c[1] - 25, c[2] - 25, 255] : c));
  speck(T.deep, [70, 68, 78], 26);
  speck(T.sand, [222, 206, 150], 22, (x, y, c) => (rnd() < 0.06 ? [c[0] - 30, c[1] - 30, c[2] - 30, 255] : c));
  speck(T.water, [48, 100, 200], 16, (x, y, c) => ((x + y * 3) % 11 === 0 ? [c[0] + 40, c[1] + 50, c[2] + 40, 255] : c));
  speck(T.logSide, [102, 76, 46], 18, (x, y, c) => (x % 4 === 0 ? [c[0] - 28, c[1] - 22, c[2] - 15, 255] : c));
  speck(T.logTop, [170, 136, 84], 14, (x, y, c) => {
    const d = Math.hypot(x - 7.5, y - 7.5); if (d > 7) return [102, 76, 46, 255];
    return Math.floor(d) % 2 ? [c[0] - 30, c[1] - 26, c[2] - 18, 255] : c;
  });
  speck(T.leaves, [58, 128, 44], 50, (x, y, c) => (rnd() < 0.22 ? [0, 0, 0, 0] : c));
  speck(T.planks, [176, 136, 82], 18, (x, y, c) => {
    if (y % 4 === 3) return [c[0] - 50, c[1] - 42, c[2] - 30, 255];
    const seam = (Math.floor(y / 4) % 2 ? 4 : 11); if (x === seam) return [c[0] - 40, c[1] - 34, c[2] - 24, 255];
    return c;
  });
  speck(T.glass, [200, 230, 240], 10, (x, y, c) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [210, 235, 245, 255];
    if ((x === y + 3 && x < 9) || (x === y + 5 && x < 8)) return [240, 250, 255, 255];
    return [0, 0, 0, 0];
  });
  speck(T.brick, [160, 70, 56], 26, (x, y, c) => {
    if (y % 4 === 3) return [190, 180, 170, 255];
    const off = Math.floor(y / 4) % 2 ? 0 : 4; if ((x + off) % 8 === 7) return [190, 180, 170, 255];
    return c;
  });
  // rubble stone: voronoi cells
  const pts = []; for (let i = 0; i < 9; i++) pts.push([rnd() * 16, rnd() * 16, 100 + rnd() * 50]);
  speck(T.cobble, [120, 120, 120], 14, (x, y, c) => {
    let a = 1e9, b = 1e9, sh = 0;
    for (const p of pts) for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
      const d = Math.hypot(x - p[0] - ox, y - p[1] - oy);
      if (d < a) { b = a; a = d; sh = p[2]; } else if (d < b) b = d;
    }
    if (b - a < 1.2) return [60, 60, 62, 255];
    return [sh + c[0] - 120, sh + c[1] - 120, sh + c[2] - 118, 255];
  });
  speck(T.snow, [240, 245, 250], 12);
  speck(T.snowSide, dirtCol, 36, (x, y, c) => (y < fringe[x] ? [240, 245, 250, 255] : c));
  ctx.putImageData(img, 0, 0);
  return cv;
}

// Isometric block icon for the hotbar
export function makeIcon(atlas, id) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const b = BLOCKS[id];
  const tileXY = (t) => [(t % ATLAS_TILES) * TILE, Math.floor(t / ATLAS_TILES) * TILE];
  const face = (tile, m, shade) => {
    const f = document.createElement('canvas'); f.width = f.height = 16; const fc = f.getContext('2d');
    const [sx, sy] = tileXY(tile); fc.drawImage(atlas, sx, sy, 16, 16, 0, 0, 16, 16);
    if (shade) { fc.globalCompositeOperation = 'source-atop'; fc.fillStyle = `rgba(0,0,0,${shade})`; fc.fillRect(0, 0, 16, 16); }
    ctx.setTransform(...m); ctx.drawImage(f, 0, 0);
  };
  face(b.top, [1, 0.5, -1, 0.5, 16, 0], 0);
  face(b.side, [1, 0.5, 0, 1, 0, 8], 0.18);
  face(b.side, [1, -0.5, 0, 1, 16, 16], 0.36);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}
