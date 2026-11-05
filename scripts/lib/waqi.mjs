// Основной источник: станции World Air Quality Index внутри границ Бишкека.
import { levelOf } from '../../assets/levels.js';
import { BBOX } from '../../config/sources.js';
import { pm10FromAqi, pm25FromAqi } from './aqi.mjs';
import { nearestDistrict, nearestPlace } from './geo.mjs';
import { fetchJson, SourceError } from './http.mjs';

const BASE = 'https://api.waqi.info';
const MAX_AGE_HOURS = 6; // станция, молчащая дольше, не участвует в расчёте
const CONCURRENCY = 5;
const SOURCE = 'waqi';

async function pool(items, worker) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }));
  return results;
}

/** Время показания. В документации WAQI встречаются оба формата: iso и пара s + tz. */
export function stationTimeIso(data, stationListItem) {
  const fromParts = data?.time?.s && data?.time?.tz ? `${data.time.s.replace(' ', 'T')}${data.time.tz}` : null;
  const raw = data?.time?.iso ?? fromParts ?? stationListItem?.station?.time;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function toPoint(item, feed, { districts, places, nowMs }) {
  const aqi = Number(feed?.aqi ?? item.aqi);
  if (!Number.isFinite(aqi) || aqi < 0) return null;
  const timestamp = stationTimeIso(feed, item);
  if (!timestamp || nowMs - Date.parse(timestamp) > MAX_AGE_HOURS * 3600e3) return null;
  const lonLat = [item.lon, item.lat];
  const district = nearestDistrict(lonLat, districts);
  if (!district) return null;
  return {
    id: `waqi-${item.uid}`,
    name: feed?.city?.name ?? item.station?.name ?? `Станция ${item.uid}`,
    lat: item.lat,
    lon: item.lon,
    district: district.id,
    neighbourhood: nearestPlace(lonLat, places),
    pm25: pm25FromAqi(feed?.iaqi?.pm25?.v),
    pm10: pm10FromAqi(feed?.iaqi?.pm10?.v),
    pm_estimated: true,
    aqi: Math.round(aqi),
    category: levelOf(aqi)?.key ?? null,
    timestamp,
    source: SOURCE,
  };
}

export async function fetchWaqi({ token, districts, places, nowMs, fetcher = fetchJson }) {
  const t = encodeURIComponent(token);
  const bounds = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const list = await fetcher(`${BASE}/v2/map/bounds?latlng=${bounds}&networks=all&token=${t}`);
  if (list?.status !== 'ok' || !Array.isArray(list.data)) {
    const reason = String(list?.data ?? list?.message ?? '');
    if (/invalid key/i.test(reason)) throw new SourceError('неверный токен');
    throw new SourceError(/quota/i.test(reason) ? 'превышена квота' : 'ошибка ответа');
  }
  const attributions = new Map();
  const points = await pool(list.data, async (item) => {
    let feed = null;
    try {
      const body = await fetcher(`${BASE}/feed/@${encodeURIComponent(item.uid)}/?token=${t}`, { retries: 0 });
      if (body?.status === 'ok') feed = body.data;
    } catch {
      // Станция без подробностей всё равно даёт общий AQI из списка
    }
    for (const a of feed?.attributions ?? []) {
      if (a?.name && /^https?:\/\//.test(a.url ?? '')) attributions.set(a.url, { name: a.name, url: a.url });
    }
    return toPoint(item, feed, { districts, places, nowMs });
  });
  const valid = points.filter(Boolean);
  if (!valid.length) throw new SourceError('нет свежих станций');
  return { points: valid, attributions: [...attributions.values()], listed: list.data.length };
}
