// Показатель IQAir для всего города. Бесплатный план даёт только AQI, без станций и PM2.5.
// Условия IQAir запрещают собирать его данные в базу без разрешения, поэтому историю мы не копим.
import { levelOf } from '../../assets/levels.js';
import { IQAIR_CITY } from '../../config/sources.js';
import { fetchJson, SourceError } from './http.mjs';

const BASE = 'https://api.airvisual.com/v2/city';
const MAX_AGE_HOURS = 6;

export function parseCity(body, nowMs) {
  if (body?.status !== 'success') {
    const reason = String(body?.data?.message ?? '');
    throw new SourceError(/incorrect_api_key|api_key_expired/.test(reason) ? 'неверный ключ' : /call_limit_reached|too_many_requests/.test(reason) ? 'превышен лимит' : 'ошибка ответа');
  }
  const pollution = body.data?.current?.pollution;
  const aqi = pollution?.aqius;
  const ms = Date.parse(pollution?.ts ?? '');
  if (typeof aqi !== 'number' || !Number.isFinite(aqi) || aqi < 0 || Number.isNaN(ms)) throw new SourceError('нет показателя');
  if (nowMs - ms > MAX_AGE_HOURS * 3600e3) throw new SourceError('устаревшие данные');
  return {
    aqi: Math.round(aqi),
    pm25: null,
    pm10: null,
    category: levelOf(aqi)?.key ?? null,
    timestamp: new Date(ms).toISOString(),
    source: 'iqair',
    stations: null,
  };
}

export async function fetchIqair({ key, nowMs, fetcher = fetchJson }) {
  const q = new URLSearchParams({ ...IQAIR_CITY, key });
  return parseCity(await fetcher(`${BASE}?${q}`), nowMs);
}
