// Разовый инструмент: скачивает границы районов и названия кварталов из OpenStreetMap,
// упрощает их и записывает config/districts.json, config/neighbourhoods.json, config/map-paths.json.
// Запускать только если границы изменились: npm run geometry
// Данные OpenStreetMap, лицензия ODbL: © участники OpenStreetMap.
import { readFile, writeFile } from 'node:fs/promises';
import { pointInRings } from './lib/geo.mjs';

const UA = 'ChemDyshim/1.0 (+https://github.com/rasulovnazim-design/chem-dyshim)';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const DISTRICTS = [
  { id: 'leninsky', name: 'Ленинский', osm: 15600027 },
  { id: 'oktyabrsky', name: 'Октябрьский', osm: 15600028 },
  { id: 'pervomaisky', name: 'Первомайский', osm: 15600026 },
  { id: 'sverdlovsky', name: 'Свердловский', osm: 15600029 },
];
const TOLERANCE = 0.0009; // примерно 80 м
const BBOX = '42.75,74.40,42.98,74.80';

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json();
}

// Дуглас-Пекер для одной линии. Общие границы районов лежат в одних и тех же way,
// поэтому упрощение каждого way отдельно сохраняет стыки без щелей.
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(area) / 2;
}

function stitch(ways) {
  const key = (p) => `${p[0]},${p[1]}`;
  const rest = ways.map((w) => [...w]);
  const rings = [];
  while (rest.length) {
    let ring = rest.shift();
    let progress = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && progress) {
      progress = false;
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        const end = key(ring[ring.length - 1]);
        if (key(w[0]) === end) { ring = ring.concat(w.slice(1)); }
        else if (key(w[w.length - 1]) === end) { ring = ring.concat([...w].reverse().slice(1)); }
        else continue;
        rest.splice(i, 1);
        progress = true;
        break;
      }
    }
    rings.push({ ring, closed: key(ring[0]) === key(ring[ring.length - 1]) });
  }
  return rings;
}

const round = (n) => Math.round(n * 10000) / 10000;

const ids = DISTRICTS.map((d) => `rel(${d.osm});`).join('');
const osm = await overpass(`[out:json][timeout:90];(${ids});out geom;`);
const simplifiedCache = new Map();
const out = [];
for (const d of DISTRICTS) {
  const rel = osm.elements.find((e) => e.id === d.osm);
  const ways = rel.members
    .filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry)
    .map((m) => {
      if (!simplifiedCache.has(m.ref)) {
        const pts = m.geometry.map((g) => [g.lon, g.lat]);
        simplifiedCache.set(m.ref, simplify(pts, TOLERANCE));
      }
      return simplifiedCache.get(m.ref);
    });
  const stitched = stitch(ways);
  const open = stitched.filter((r) => !r.closed).length;
  const rings = stitched
    .filter((r) => r.closed && ringArea(r.ring) > 1e-5)
    .map((r) => r.ring.map(([x, y]) => [round(x), round(y)]));
  console.log(`${d.name}: колец ${rings.length}, незамкнутых ${open}, точек ${rings.reduce((a, r) => a + r.length, 0)}`);
  out.push({ id: d.id, name: d.name, osm_relation: d.osm, rings });
}

await writeFile('config/districts.json', `${JSON.stringify({
  _note: 'Границы районов Бишкека из OpenStreetMap (ODbL), упрощены. Обновляется командой npm run geometry.',
  districts: out,
}, null, 1)}\n`);

// SVG: равнопромежуточная проекция с поправкой на широту. Рисуем только основную часть каждого района:
// мелкие анклавы далеко за городом растягивают карту, а для принадлежности датчиков они остаются в districts.json.
const mainRing = (d) => [...d.rings].sort((a, b) => ringArea(b) - ringArea(a))[0];
const all = out.flatMap((d) => mainRing(d));
const minX = Math.min(...all.map((p) => p[0]));
const maxX = Math.max(...all.map((p) => p[0]));
const minY = Math.min(...all.map((p) => p[1]));
const maxY = Math.max(...all.map((p) => p[1]));
const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
const W = 360;
const scale = W / ((maxX - minX) * k);
const H = Math.ceil((maxY - minY) * scale);
const project = ([x, y]) => [((x - minX) * k * scale), ((maxY - y) * scale)];
const fmt = (n) => (Math.round(n * 10) / 10).toString();

// Точка внутри фигуры, самая далёкая от её границ: туда и ставим подпись
function visualCentre(ring) {
  const pts = ring.map(project);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (((pts[i][1] > y) !== (pts[j][1] > y)) && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
    }
    return hit;
  };
  const edgeDistance = (x, y) => {
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j];
      const [bx, by] = pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
  let top = [0, 0];
  let topD = -1;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 2) {
      if (!inside(x, y)) continue;
      const d = edgeDistance(x, y);
      if (d > topD) { topD = d; top = [x, y]; }
    }
  }
  return top.map((n) => Math.round(n));
}

const paths = {};
const labels = {};
for (const d of out) {
  const ring = mainRing(d);
  paths[d.id] = `M${ring.map((p) => project(p).map(fmt).join(' ')).join('L')}Z`;
  labels[d.id] = visualCentre(ring);
}
await writeFile('config/map-paths.json', `${JSON.stringify({ width: W, height: H, paths, labels }, null, 1)}\n`);
console.log(`SVG ${W}x${H}, размер путей ${Object.values(paths).join('').length} байт`, labels);

// Кварталы и жилмассивы: подпись для каждого датчика
const places = await overpass(`[out:json][timeout:60];node["place"~"suburb|neighbourhood|quarter|village"](${BBOX});out;`);
const clean = (s) => {
  const name = s.replace(/\s*жилмассив\s*/i, ' ').replace(/\s*микрорайон\s*/i, ' ').trim().replace(/\s+/g, ' ');
  return /^\d+-й$/.test(name) ? `${name} мкр` : name;
};
const seen = new Set();
const hoods = [{ name: 'Центр', lat: 42.8761, lon: 74.6033 }];
for (const e of places.elements) {
  const raw = e.tags['name:ru'] || e.tags.name;
  if (!raw) continue;
  const inside = out.some((d) => pointInRings([e.lon, e.lat], d.rings));
  if (!inside) continue;
  const name = clean(raw);
  if (seen.has(name)) continue;
  seen.add(name);
  hoods.push({ name, lat: round(e.lat), lon: round(e.lon) });
}
await writeFile('config/neighbourhoods.json', `${JSON.stringify({
  _note: 'Названия жилмассивов внутри границ города из OpenStreetMap (ODbL). Можно править и дополнять вручную.',
  places: hoods,
}, null, 1)}\n`);
console.log(`Кварталов внутри города: ${hoods.length}`);
