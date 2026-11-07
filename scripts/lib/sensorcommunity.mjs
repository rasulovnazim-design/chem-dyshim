// Датчики жителей из открытой сети Sensor.Community. Ключ не нужен, показания сразу в мкг/м³.
// Файл читают и скрипты, и браузер: при открытии страницы показания обновляются прямо у читателя.
import { levelOf } from '../../assets/levels.js';
import { BBOX, SENSOR_EXCLUDE } from '../../config/sources.js';
import { aqiFromPm25 } from './aqi.mjs';
import { nearestDistrict, nearestPlace } from './geo.mjs';
import { fetchJson, SourceError } from './http.mjs';

export const SOURCE = 'sensor-community';
const MAX_PM25 = 500; // выше этого такие датчики уже сбоят
const OUTLIER_FACTOR = 5;
const OUTLIER_FLOOR = 150;

export const boxUrl = ({ north, east, south, west } = BBOX) => `https://data.sensor.community/airrohr/v1/filter/box=${north},${east},${south},${west}`;

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;

function middle(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Показания по каждому датчику за последние минуты. Датчики в помещении и без PM2.5 не считаются. */
export function parseReadings(body, exclude = SENSOR_EXCLUDE) {
  const bySensor = new Map();
  for (const record of Array.isArray(body) ? body : []) {
    const id = record?.sensor?.id;
    if (!id || exclude.includes(id) || record.location?.indoor) continue;
    const value = (type) => Number(record.sensordatavalues?.find((v) => v.value_type === type)?.value ?? NaN);
    const pm25 = value('P2');
    if (!Number.isFinite(pm25) || pm25 < 0 || pm25 >= MAX_PM25) continue;
    const lat = Number(record.location?.latitude);
    const lon = Number(record.location?.longitude);
    const ms = Date.parse(`${String(record.timestamp).replace(' ', 'T')}Z`);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(ms)) continue;
    if (!bySensor.has(id)) bySensor.set(id, { sensorId: id, lat, lon, pm25: [], pm10: [], ms });
    const entry = bySensor.get(id);
    entry.pm25.push(pm25);
    const pm10 = value('P1');
    if (Number.isFinite(pm10) && pm10 >= 0) entry.pm10.push(pm10);
    entry.ms = Math.max(entry.ms, ms);
  }
  return [...bySensor.values()].map((e) => ({
    sensorId: e.sensorId,
    lat: e.lat,
    lon: e.lon,
    pm25: round1(average(e.pm25)),
    pm10: e.pm10.length ? round1(average(e.pm10)) : null,
    timestamp: new Date(e.ms).toISOString(),
  }));
}

/**
 * Отбрасывает явно сбойный датчик: намного выше остальных и при этом высокое значение.
 * Порог высокий намеренно: датчик рядом с печной трубой может показывать втрое больше соседей, и это правда.
 */
export function dropOutliers(readings) {
  return readings.filter((r) => {
    const others = middle(readings.filter((o) => o !== r).map((o) => o.pm25));
    return !(others !== null && r.pm25 > OUTLIER_FLOOR && r.pm25 > OUTLIER_FACTOR * others);
  });
}

const pointId = (sensorId) => `sc-${sensorId}`;

const measured = (r) => {
  const aqi = aqiFromPm25(r.pm25);
  return {
    pm25: r.pm25,
    pm10: r.pm10,
    pm_estimated: false,
    aqi,
    category: levelOf(aqi)?.key ?? null,
    timestamp: r.timestamp,
    source: SOURCE,
  };
};

export function toPoints(readings, { districts, places }) {
  return readings.map((r) => {
    const lonLat = [r.lon, r.lat];
    return {
      id: pointId(r.sensorId),
      name: `Датчик ${r.sensorId}`,
      lat: r.lat,
      lon: r.lon,
      district: nearestDistrict(lonLat, districts).id,
      neighbourhood: nearestPlace(lonLat, places),
      ...measured(r),
    };
  });
}

/** Свежие показания в браузере: район и подпись уже известны из data/aqi.json, границы районов грузить не нужно. */
export function refreshPoints(body, points) {
  const known = new Map(points.filter((p) => p.source === SOURCE).map((p) => [p.id, p]));
  return dropOutliers(parseReadings(body))
    .filter((r) => known.has(pointId(r.sensorId)))
    .map((r) => ({ ...known.get(pointId(r.sensorId)), ...measured(r) }));
}

export async function fetchSensorCommunity({ districts, places, fetcher = fetchJson }) {
  const readings = dropOutliers(parseReadings(await fetcher(boxUrl())));
  if (!readings.length) throw new SourceError('нет работающих датчиков');
  return { points: toPoints(readings, { districts, places }) };
}
