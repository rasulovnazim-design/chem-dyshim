// Геометрия: принадлежность точки району и расстояния. Точки задаются как [lon, lat].

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const pointInRings = (p, rings) => rings.some((r) => pointInRing(p, r));

export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const r = 6371;
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function distanceToSegmentKm(p, a, b) {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k; const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k; const by = b[1] - p[1];
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy) * 111.19;
}

/** Район, внутри которого лежит точка, иначе ближайший по расстоянию до границы. */
export function nearestDistrict(p, districts) {
  let best = null;
  let bestD = Infinity;
  for (const d of districts) {
    if (pointInRings(p, d.rings)) return { id: d.id, name: d.name, distance_km: 0 };
    for (const ring of d.rings) {
      for (let i = 1; i < ring.length; i++) {
        const dist = distanceToSegmentKm(p, ring[i - 1], ring[i]);
        if (dist < bestD) { bestD = dist; best = d; }
      }
    }
  }
  return best ? { id: best.id, name: best.name, distance_km: Math.round(bestD * 10) / 10 } : null;
}

/** Подпись ближайшего жилмассива. Дальше maxKm подпись не ставится: она бы вводила в заблуждение. */
export function nearestPlace(p, places, maxKm = 3) {
  let best = null;
  let bestD = Infinity;
  for (const place of places) {
    const d = distanceKm(p, [place.lon, place.lat]);
    if (d < bestD) { bestD = d; best = place; }
  }
  return best && bestD <= maxKm ? best.name : null;
}
