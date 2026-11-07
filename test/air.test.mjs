import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { levelIndex, levelOf, LEVELS } from '../assets/levels.js';
import { buildHistory, mergeSeries, updateAir } from '../scripts/lib/air.mjs';
import { median, pm10FromAqi, pm25FromAqi, summarise } from '../scripts/lib/aqi.mjs';
import { nearestDistrict, nearestPlace } from '../scripts/lib/geo.mjs';
import { SourceError } from '../scripts/lib/http.mjs';
import { fetchWaqi, stationTimeIso, toPoint } from '../scripts/lib/waqi.mjs';
import { parseCurrent, parseHourly } from '../scripts/lib/openmeteo.mjs';

const noSensors = async () => { throw new SourceError('нет работающих датчиков'); };
const { districts } = JSON.parse(readFileSync('config/districts.json', 'utf8'));
const { places } = JSON.parse(readFileSync('config/neighbourhoods.json', 'utf8'));
const NOW = Date.parse('2026-11-05T04:00:00Z');

test('границы категорий AQI', () => {
  assert.deepEqual([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 600].map(levelIndex), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(levelOf(null), null);
  assert.equal(levelIndex(Number.NaN), -1);
});

test('цвета уровней читаются на белом фоне', () => {
  const lum = (hex) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  for (const l of LEVELS) assert.ok(1.05 / (lum(l.color) + 0.05) >= 4.5, l.key);
});

test('обратный расчёт концентрации из суб-индекса', () => {
  assert.equal(pm25FromAqi(50), 12);
  assert.equal(pm25FromAqi(100), 35.4);
  assert.equal(pm25FromAqi(150), 55.4);
  assert.equal(pm10FromAqi(50), 54);
  assert.equal(pm25FromAqi(undefined), null);
  assert.ok(pm25FromAqi(700) <= 500.4);
});

test('медиана устойчива к одному сбойному датчику', () => {
  assert.equal(median([50, 60, 70, 900]), 65);
  const s = summarise([
    { aqi: 50, pm25: 10, pm10: 20, timestamp: '2026-11-05T03:00:00.000Z' },
    { aqi: 60, pm25: 12, pm10: null, timestamp: '2026-11-05T03:30:00.000Z' },
    { aqi: 900, pm25: null, pm10: 30, timestamp: '2026-11-05T02:00:00.000Z' },
  ], 'waqi');
  assert.equal(s.aqi, 60);
  assert.equal(s.category, 'moderate');
  assert.equal(s.timestamp, '2026-11-05T03:30:00.000Z');
  assert.equal(s.stations, 3);
});

test('район и подпись квартала', () => {
  assert.equal(nearestDistrict([74.6249, 42.8185], districts).id, 'oktyabrsky');
  assert.equal(nearestDistrict([74.529, 42.8692], districts).id, 'leninsky');
  assert.equal(nearestDistrict([74.6033, 42.8761], districts).id, 'pervomaisky');
  assert.equal(nearestDistrict([74.6847, 42.878], districts).id, 'sverdlovsky');
  const outside = nearestDistrict([74.71, 42.95], districts);
  assert.ok(outside.distance_km > 0);
  assert.equal(nearestPlace([74.6324, 42.873], places), 'Восток-5');
  assert.equal(nearestPlace([75.5, 43.5], places), null);
});

const station = (uid, aqi, lat, lon) => ({ uid, aqi: String(aqi), lat, lon, station: { name: `S${uid}`, time: '2026-11-05T09:30:00+06:00' } });
const feed = (aqi, pm25) => ({ status: 'ok', data: {
  aqi, city: { name: 'Станция' }, iaqi: { pm25: { v: pm25 } }, time: { iso: '2026-11-05T09:30:00+06:00' },
  attributions: [{ url: 'https://aqicn.org', name: 'WAQI' }, { url: 'javascript:alert(1)', name: 'bad' }],
} });

test('WAQI: разбор станций, суб-индекс не считается концентрацией', async () => {
  const fetcher = async (url) => {
    if (url.includes('map/bounds')) {
      return { status: 'ok', data: [station(1, 150, 42.8692, 74.529), station(2, '-', 42.87, 74.6), station(3, 120, 42.8185, 74.6249)] };
    }
    if (url.includes('@2')) return { status: 'ok', data: { aqi: '-', iaqi: {} } };
    return url.includes('@3') ? { status: 'error' } : feed(150, 150);
  };
  const out = await fetchWaqi({ token: 't', districts, places, nowMs: NOW, fetcher });
  assert.equal(out.points.length, 2);
  const a = out.points.find((p) => p.id === 'waqi-1');
  assert.equal(a.district, 'leninsky');
  assert.equal(a.neighbourhood, 'Кызыл-Аскер');
  assert.equal(a.pm25, 55.4, 'суб-индекс 150 это 55.4 мкг/м³, а не 150');
  assert.equal(a.pm_estimated, true);
  const b = out.points.find((p) => p.id === 'waqi-3');
  assert.equal(b.aqi, 120, 'без подробностей станции берём общий AQI из списка');
  assert.equal(out.attributions.length, 1, 'ссылка javascript: отброшена');
});

test('WAQI: станция с устаревшими данными не участвует', () => {
  const item = station(1, 100, 42.87, 74.53);
  const old = { aqi: 100, time: { iso: '2026-11-04T09:30:00+06:00' } };
  assert.equal(toPoint(item, old, { districts, places, nowMs: NOW }), null);
});

test('WAQI: время показания во всех форматах из документации', () => {
  const want = '2026-11-05T03:30:00.000Z';
  assert.equal(stationTimeIso({ time: { iso: '2026-11-05T09:30:00+06:00' } }), want);
  assert.equal(stationTimeIso({ time: { s: '2026-11-05 09:30:00', tz: '+06:00', v: 1 } }), want);
  assert.equal(stationTimeIso(null, { station: { time: '2026-11-05T09:30:00+06:00' } }), want);
  assert.equal(stationTimeIso({}, {}), null);
});

test('WAQI: понятные ошибки неверного токена и квоты', async () => {
  const run = (body) => fetchWaqi({ token: 't', districts, places, nowMs: NOW, fetcher: async () => body });
  await assert.rejects(run({ status: 'error', data: 'Invalid key' }), /неверный токен/);
  await assert.rejects(run({ status: 'error', message: 'Over quota' }), /превышена квота/);
});

test('токен никогда не попадает в публичный статус', async () => {
  const deps = {
    fetchSensorCommunity: noSensors,
    fetchIqair: async () => { throw new Error('https://x/?key=SECRET'); },
    fetchWaqi: async () => { throw new SourceError('HTTP 500'); },
    fetchOpenMeteo: async () => { throw new Error('https://x/?token=SECRET'); },
  };
  const out = await updateAir({ prev: null, token: 'SECRET', iqairKey: 'SECRET', districts, places, nowMs: NOW, deps });
  assert.ok(!JSON.stringify(out).includes('SECRET'));
  assert.equal(out.status.waqi, 'ошибка: HTTP 500');
  assert.equal(out.status.open_meteo, 'ошибка: внутренняя ошибка');
});

const meteoBody = () => [
  { current: { time: NOW / 1000, us_aqi: 80, pm2_5: 20, pm10: 30 }, hourly: { time: [NOW / 1000 - 3600, NOW / 1000, NOW / 1000 + 3600], us_aqi: [70, 80, 999], pm2_5: [10, 20, 999], pm10: [10, 30, 999] } },
  { current: { time: NOW / 1000, us_aqi: 90, pm2_5: 25, pm10: 35 }, hourly: { time: [NOW / 1000 - 3600, NOW / 1000, NOW / 1000 + 3600], us_aqi: [72, 90, 999], pm2_5: [11, 25, 999], pm10: [11, 35, 999] } },
];

test('Open-Meteo: текущие значения и история без будущих часов', () => {
  const pts = [{ id: 'a', name: 'A', lat: 1, lon: 1, district: 'leninsky', neighbourhood: 'A' }, { id: 'b', name: 'B', lat: 2, lon: 2, district: 'oktyabrsky', neighbourhood: 'B' }];
  const cur = parseCurrent(meteoBody(), pts);
  assert.equal(cur[0].aqi, 80);
  assert.equal(cur[0].source, 'open-meteo');
  const h = parseHourly(meteoBody(), NOW, pts);
  assert.equal(h.city.length, 2);
  assert.equal(h.city[1][1], 85);
  assert.equal(h.city[1][4], 'm');
  assert.equal(h.points.a.length, 2);
});

const meteoResult = (aqi = 80) => ({
  points: [{ id: 'om-a', district: 'leninsky', neighbourhood: 'A', aqi, pm25: 20, pm10: 30, timestamp: new Date(NOW).toISOString(), source: 'open-meteo' }],
  history: { city: [[NOW / 1000 - 3600, 70, 10, 10, 'm']], points: { 'om-a': [[NOW / 1000 - 3600, 70, 10, 10]] } },
});

test('нет токена: работает резерв, районы не сравниваются', async () => {
  const out = await updateAir({ prev: null, token: '', districts, places, nowMs: NOW, deps: { fetchSensorCommunity: noSensors, fetchOpenMeteo: async () => meteoResult() } });
  assert.equal(out.source, 'open-meteo');
  assert.equal(out.status.waqi, 'нет токена');
  assert.equal(out.districts_comparable, false);
  assert.equal(out.districts.leninsky.aqi, 80);
  assert.equal(out.districts.oktyabrsky.aqi, null);
  assert.equal(out.history.city.length, 2, 'первый запуск заполняет историю из модели');
});

test('сбой WAQI переключает на резерв, сбой обоих сохраняет прошлые данные', async () => {
  const fail = async () => { throw new SourceError('HTTP 500'); };
  const first = await updateAir({ prev: null, token: 't', districts, places, nowMs: NOW, deps: { fetchSensorCommunity: noSensors, fetchWaqi: fail, fetchOpenMeteo: async () => meteoResult() } });
  assert.equal(first.source, 'open-meteo');
  assert.match(first.status.waqi, /^ошибка/);
  const second = await updateAir({ prev: first, token: 't', districts, places, nowMs: NOW + 1800e3, deps: { fetchSensorCommunity: noSensors, fetchWaqi: fail, fetchOpenMeteo: fail } });
  assert.equal(second.city.aqi, 80);
  assert.equal(second.generated_at, first.generated_at);
  assert.equal(second.last_attempt_at, new Date(NOW + 1800e3).toISOString());
  const none = await updateAir({ prev: null, token: '', districts, places, nowMs: NOW, deps: { fetchSensorCommunity: noSensors, fetchOpenMeteo: fail } });
  assert.equal(none.city, null);
});

test('датчики считаются сравнимыми, если есть данные хотя бы по двум районам', async () => {
  const pt = (id, district, aqi) => ({ id, district, neighbourhood: id, aqi, pm25: 1, pm10: 1, timestamp: new Date(NOW).toISOString(), source: 'waqi' });
  const out = await updateAir({
    prev: null, token: 't', districts, places, nowMs: NOW,
    deps: { fetchSensorCommunity: noSensors, fetchWaqi: async () => ({ points: [pt('a', 'leninsky', 100), pt('b', 'oktyabrsky', 200)], attributions: [] }), fetchOpenMeteo: async () => meteoResult(60) },
  });
  assert.equal(out.source, 'waqi');
  assert.equal(out.districts_comparable, true);
  assert.equal(out.model_check.aqi, 60);
  assert.equal(out.history.city.at(-1)[4], 's');
});

test('история: окно 7 дней, без дублей по времени, повторно не дозаполняется', () => {
  const t = NOW / 1000;
  const merged = mergeSeries([[t - 8 * 86400, 1], [t - 100, 2]], [[t - 100, 3], [t, 4]], NOW);
  assert.deepEqual(merged, [[t - 100, 3], [t, 4]]);
  const iso = new Date(NOW).toISOString();
  const first = buildHistory(null, { points: [], city: { timestamp: iso, aqi: 5, pm25: 1, pm10: 1 }, source: 'waqi', backfill: { city: [[t - 3600, 9, 1, 1, 'm']], points: {} }, nowMs: NOW });
  assert.equal(first.city.length, 2);
  const later = buildHistory(first, { points: [], city: { timestamp: new Date(NOW + 1800e3).toISOString(), aqi: 6, pm25: 1, pm10: 1 }, source: 'waqi', backfill: { city: [[t - 7200, 9, 1, 1, 'm']], points: {} }, nowMs: NOW + 1800e3 });
  assert.equal(later.city.length, 3, 'дозаполнение моделью только в самый первый раз');
});
