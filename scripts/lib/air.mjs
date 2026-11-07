// Сборка data/aqi.json: выбор источника, районы, скользящая история за 7 дней.
import { MIN_COMMUNITY_SENSORS } from '../../config/sources.js';
import { comparableDistricts, districtSummaries, summarise } from './aqi.mjs';
import { errorText } from './http.mjs';
import { fetchIqair } from './iqair.mjs';
import { fetchOpenMeteo } from './openmeteo.mjs';
import { fetchSensorCommunity, SOURCE as COMMUNITY } from './sensorcommunity.mjs';
import { fetchWaqi } from './waqi.mjs';

const WEEK_S = 7 * 24 * 3600;
const SOURCE_FLAG = { waqi: 's', [COMMUNITY]: 's', 'open-meteo': 'm' };

export function mergeSeries(series, entries, nowMs) {
  const cutoff = Math.floor(nowMs / 1000) - WEEK_S;
  const byTime = new Map((series ?? []).map((e) => [e[0], e]));
  for (const e of entries) byTime.set(e[0], e);
  return [...byTime.values()].filter((e) => e[0] >= cutoff).sort((a, b) => a[0] - b[0]);
}

export function buildHistory(prev, { points, city, source, backfill, nowMs }) {
  const toSec = (iso) => Math.floor(Date.parse(iso) / 1000);
  const flag = SOURCE_FLAG[source];
  const hadCity = (prev?.city?.length ?? 0) > 0;
  const seedCity = !hadCity && backfill ? backfill.city : [];
  const cityEntry = city?.timestamp ? [[toSec(city.timestamp), city.aqi, city.pm25, city.pm10, flag]] : [];
  const history = { city: mergeSeries(prev?.city, [...seedCity, ...cityEntry], nowMs), points: {} };

  const ids = new Set([...Object.keys(prev?.points ?? {}), ...points.map((p) => p.id)]);
  if (!hadCity && backfill) Object.keys(backfill.points).forEach((id) => ids.add(id));
  for (const id of ids) {
    const p = points.find((x) => x.id === id);
    const seed = !hadCity && backfill?.points?.[id] ? backfill.points[id] : [];
    const entry = p?.timestamp ? [[toSec(p.timestamp), p.aqi, p.pm25, p.pm10]] : [];
    const merged = mergeSeries(prev?.points?.[id], [...seed, ...entry], nowMs);
    if (merged.length) history.points[id] = merged;
  }
  return history;
}

/** Один источник: успех записывается в статус, сбой не мешает остальным. */
async function attempt(status, name, okText, fn) {
  try {
    const value = await fn();
    status[name] = okText(value);
    return value;
  } catch (err) {
    status[name] = `ошибка: ${errorText(err)}`;
    return null;
  }
}

/**
 * Собирает новый aqi.json. Не бросает исключений: при сбое всех источников возвращает прежние данные.
 *
 * Главная цифра: IQAir, затем медиана станций или датчиков, затем модель.
 * Карта: станции WAQI, если подключены, затем датчики жителей, затем модель.
 * История: станции или модель. IQAir в неё не попадает, его условия запрещают собирать данные в базу.
 */
export async function updateAir({ prev, token, iqairKey, districts, places, nowMs, deps = {} }) {
  const status = {};
  const count = (r) => `ok: точек ${r.points.length}`;

  let iqair = null;
  if (iqairKey) {
    iqair = await attempt(status, 'iqair', () => 'ok', () => (deps.fetchIqair ?? fetchIqair)({ key: iqairKey, nowMs }));
  } else {
    status.iqair = 'нет ключа';
  }

  let waqi = null;
  if (token) {
    waqi = await attempt(status, 'waqi', count, () => (deps.fetchWaqi ?? fetchWaqi)({ token, districts, places, nowMs }));
  } else {
    status.waqi = 'нет токена';
  }

  const community = await attempt(status, 'sensor_community', count, () => (deps.fetchSensorCommunity ?? fetchSensorCommunity)({ districts, places, nowMs }));
  const meteo = await attempt(status, 'open_meteo', () => 'ok', () => (deps.fetchOpenMeteo ?? fetchOpenMeteo)({ nowMs }));

  const stations = waqi ?? community;
  const stationSource = waqi ? 'waqi' : community ? COMMUNITY : null;
  const enoughStations = stations && (waqi || stations.points.length >= MIN_COMMUNITY_SENSORS);
  const stationCity = enoughStations ? summarise(stations.points, stationSource) : null;
  const modelCity = meteo ? summarise(meteo.points, 'open-meteo') : null;
  const city = iqair ?? stationCity ?? modelCity;

  const nowIso = new Date(nowMs).toISOString();
  if (!city) {
    return { ...(prev ?? { schema: 1, city: null, districts: null, points: [], history: { city: [], points: {} } }), status, last_attempt_at: nowIso };
  }

  const mapPoints = stations?.points ?? meteo?.points ?? [];
  const mapSource = stations ? stationSource : 'open-meteo';
  const districtData = districtSummaries(mapPoints, mapSource, districts);
  const chartCity = stationCity ?? modelCity;
  return {
    schema: 1,
    generated_at: nowIso,
    last_attempt_at: nowIso,
    status,
    source: city.source,
    city,
    station_check: stationCity,
    model_check: modelCity,
    districts: districtData,
    districts_source: mapSource,
    // Сравнивать районы честно только по реальным датчикам: модель их почти не различает
    districts_comparable: Boolean(stations) && comparableDistricts(districtData),
    points: mapPoints,
    attributions: waqi?.attributions ?? [],
    history: buildHistory(prev?.history, {
      points: mapPoints, city: chartCity, source: chartCity?.source, backfill: meteo?.history ?? null, nowMs,
    }),
  };
}
