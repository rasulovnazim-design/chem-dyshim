// Резервный источник: модель CAMS через Open-Meteo. Ключ не нужен.
// Важно: это расчёт модели, а не измерение датчика. Ячейки сетки крупные, поэтому
// районы города модель почти не различает.
import { levelOf } from '../../assets/levels.js';
import { FALLBACK_POINTS } from '../../config/sources.js';
import { median } from './aqi.mjs';
import { fetchJson, SourceError } from './http.mjs';

const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const SOURCE = 'open-meteo';

export function buildUrl(points = FALLBACK_POINTS, { hourly = false } = {}) {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    current: 'pm10,pm2_5,us_aqi',
    timeformat: 'unixtime',
    timezone: 'UTC',
  });
  if (hourly) {
    q.set('hourly', 'pm10,pm2_5,us_aqi');
    q.set('past_days', '7');
    q.set('forecast_days', '1');
  }
  return `${BASE}?${q}`;
}

export function parseCurrent(body, points = FALLBACK_POINTS) {
  const rows = Array.isArray(body) ? body : [body];
  return points.map((p, i) => {
    const c = rows[i]?.current;
    if (!c || typeof c.us_aqi !== 'number') return null;
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      district: p.district,
      neighbourhood: p.neighbourhood,
      pm25: c.pm2_5 ?? null,
      pm10: c.pm10 ?? null,
      pm_estimated: false,
      aqi: Math.round(c.us_aqi),
      category: levelOf(c.us_aqi)?.key ?? null,
      timestamp: new Date(c.time * 1000).toISOString(),
      source: SOURCE,
    };
  }).filter(Boolean);
}

/** История по часам: для каждой точки и медиана по городу. Будущие часы отбрасываются. */
export function parseHourly(body, nowMs, points = FALLBACK_POINTS) {
  const rows = Array.isArray(body) ? body : [body];
  const byPoint = {};
  const byHour = new Map();
  points.forEach((p, i) => {
    const h = rows[i]?.hourly;
    if (!h) return;
    byPoint[p.id] = [];
    h.time.forEach((t, j) => {
      const aqi = h.us_aqi?.[j];
      if (typeof aqi !== 'number' || t * 1000 > nowMs) return;
      const entry = [t, Math.round(aqi), h.pm2_5?.[j] ?? null, h.pm10?.[j] ?? null];
      byPoint[p.id].push(entry);
      if (!byHour.has(t)) byHour.set(t, []);
      byHour.get(t).push(entry);
    });
  });
  const city = [...byHour.keys()].sort((a, b) => a - b).map((t) => {
    const es = byHour.get(t);
    return [t, Math.round(median(es.map((e) => e[1]))), median(es.map((e) => e[2])), median(es.map((e) => e[3])), 'm'];
  });
  return { city, points: byPoint };
}

export async function fetchOpenMeteo({ nowMs, fetcher = fetchJson }) {
  const body = await fetcher(buildUrl(FALLBACK_POINTS, { hourly: true }));
  const points = parseCurrent(body);
  if (!points.length) throw new SourceError('пустой ответ');
  return { points, history: parseHourly(body, nowMs) };
}
