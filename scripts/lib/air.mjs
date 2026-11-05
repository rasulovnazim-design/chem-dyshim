// Сборка data/aqi.json: выбор источника, районы, скользящая история за 7 дней.
import { DISTRICT_IDS } from '../../config/sources.js';
import { summarise } from './aqi.mjs';
import { errorText } from './http.mjs';
import { fetchOpenMeteo } from './openmeteo.mjs';
import { fetchWaqi } from './waqi.mjs';

const WEEK_S = 7 * 24 * 3600;
const SOURCE_FLAG = { waqi: 's', 'open-meteo': 'm' };

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

export function districtSummaries(points, source, districts) {
  const names = Object.fromEntries(districts.map((d) => [d.id, d.name]));
  return Object.fromEntries(DISTRICT_IDS.map((id) => {
    const own = points.filter((p) => p.district === id);
    const summary = summarise(own, source);
    return [id, {
      name: names[id] ?? id,
      ...(summary ?? { aqi: null, pm25: null, pm10: null, category: null, timestamp: null, source, stations: 0 }),
      neighbourhoods: [...new Set(own.map((p) => p.neighbourhood).filter(Boolean))],
    }];
  }));
}

/** Собирает новый aqi.json. Не бросает исключений: при сбое всех источников возвращает прежние данные. */
export async function updateAir({ prev, token, districts, places, nowMs, deps = {} }) {
  const waqiFn = deps.fetchWaqi ?? fetchWaqi;
  const meteoFn = deps.fetchOpenMeteo ?? fetchOpenMeteo;
  const status = {};

  let waqi = null;
  if (token) {
    try {
      waqi = await waqiFn({ token, districts, places, nowMs });
      status.waqi = `ok: станций ${waqi.points.length}`;
    } catch (err) {
      status.waqi = `ошибка: ${errorText(err)}`;
    }
  } else {
    status.waqi = 'нет токена';
  }

  let meteo = null;
  try {
    meteo = await meteoFn({ nowMs });
    status.open_meteo = 'ok';
  } catch (err) {
    status.open_meteo = `ошибка: ${errorText(err)}`;
  }

  const nowIso = new Date(nowMs).toISOString();
  const active = waqi ?? meteo;
  if (!active) {
    return { ...(prev ?? { schema: 1, city: null, districts: null, points: [], history: { city: [], points: {} } }), status, last_attempt_at: nowIso };
  }

  const source = waqi ? 'waqi' : 'open-meteo';
  const city = summarise(active.points, source);
  const withData = Object.values(districtSummaries(active.points, source, districts)).filter((d) => d.aqi !== null).length;
  return {
    schema: 1,
    generated_at: nowIso,
    last_attempt_at: nowIso,
    status,
    source,
    // Сравнивать районы честно только по датчикам: модель их почти не различает
    districts_comparable: source === 'waqi' && withData >= 2,
    city,
    model_check: meteo ? summarise(meteo.points, 'open-meteo') : null,
    districts: districtSummaries(active.points, source, districts),
    points: active.points,
    attributions: waqi?.attributions ?? [],
    history: buildHistory(prev?.history, {
      points: active.points, city, source, backfill: meteo?.history ?? null, nowMs,
    }),
  };
}
