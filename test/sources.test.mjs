import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chooseReading } from '../assets/freshness.js';
import { updateAir } from '../scripts/lib/air.mjs';
import { aqiFromPm25 } from '../scripts/lib/aqi.mjs';
import { fetchIqair, parseCity } from '../scripts/lib/iqair.mjs';
import { SourceError } from '../scripts/lib/http.mjs';
import { boxUrl, dropOutliers, fetchSensorCommunity, parseReadings, refreshPoints } from '../scripts/lib/sensorcommunity.mjs';
import { morningPost } from '../scripts/lib/telegram.mjs';

const { districts } = JSON.parse(readFileSync('config/districts.json', 'utf8'));
const { places } = JSON.parse(readFileSync('config/neighbourhoods.json', 'utf8'));
const NOW = Date.parse('2026-11-07T13:15:00Z');
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();

const record = (id, p2, p1, lat, lon, extra = {}) => ({
  sensor: { id, sensor_type: { name: 'SDS011' } },
  location: { latitude: String(lat), longitude: String(lon), indoor: 0 },
  timestamp: '2026-11-07 13:14:00',
  sensordatavalues: [{ value_type: 'P2', value: String(p2) }, { value_type: 'P1', value: String(p1) }],
  ...extra,
});
const reading = (sensorId, pm25) => ({ sensorId, pm25, pm10: null, lat: 42.87, lon: 74.6, timestamp: ago(0) });

test('AQI из PM2.5 по таблице EPA 2024', () => {
  const cases = [[0, 0], [9, 50], [9.05, 50], [35.4, 100], [55.4, 150], [125.4, 200], [225.4, 300], [325.4, 500], [900, 500]];
  for (const [c, aqi] of cases) assert.equal(aqiFromPm25(c), aqi, String(c));
  assert.equal(aqiFromPm25(47), 129, 'совпадает с парой 47 мкг/м³ и AQI 129 на странице IQAir');
  assert.equal(aqiFromPm25(null), null);
  assert.equal(aqiFromPm25(-1), null);
});

test('датчики: усреднение, помещение, температурные датчики и явно сбойные значения', () => {
  const rows = parseReadings([
    record(1, 10, 20, 42.87, 74.6),
    record(1, 20, 40, 42.87, 74.6),
    record(2, 15, 30, 42.84, 74.6, { location: { latitude: '42.84', longitude: '74.6', indoor: 1 } }),
    record(3, 696.5, 852, 42.81, 74.62),
    record(4, 'нет', 3, 42.81, 74.62),
    { sensor: { id: 5 }, location: { latitude: '42.8', longitude: '74.6', indoor: 0 }, timestamp: '2026-11-07 13:14:00', sensordatavalues: [{ value_type: 'temperature', value: '18' }] },
  ], []);
  assert.deepEqual(rows.map((r) => r.sensorId), [1]);
  assert.equal(rows[0].pm25, 15);
  assert.equal(rows[0].pm10, 30);
  assert.equal(rows[0].timestamp, '2026-11-07T13:14:00.000Z', 'время датчиков указано в UTC');
  assert.deepEqual(parseReadings('не массив'), []);
});

test('датчик из списка исключений не учитывается', () => {
  assert.deepEqual(parseReadings([record(35745, 100, 200, 42.8, 74.6)]), []);
});

test('отбрасывает сбойный датчик по реальным показаниям, оставляет настоящий местный дым', () => {
  // 5 ноября: 393 мкг/м³ при соседях 18, 44, 101, 196
  const nov5 = [393, 196, 101, 44, 18].map((v, i) => reading(i, v));
  assert.deepEqual(dropOutliers(nov5).map((r) => r.pm25), [196, 101, 44, 18]);
  // 7 ноября: 112 при соседях 13 и 19 это местный источник, а не поломка
  const nov7 = [112, 19, 13].map((v, i) => reading(i, v));
  assert.equal(dropOutliers(nov7).length, 3);
  // Настоящий сильный смог: высокие цифры у всех сразу
  const smog = [300, 280, 260].map((v, i) => reading(i, v));
  assert.equal(dropOutliers(smog).length, 3);
  assert.equal(dropOutliers([reading(1, 450)]).length, 1, 'сравнивать не с чем');
});

test('датчики получают район и подпись, адрес запроса верный', async () => {
  assert.equal(boxUrl(), 'https://data.sensor.community/airrohr/v1/filter/box=42.95,74.72,42.78,74.45');
  const out = await fetchSensorCommunity({
    districts,
    places,
    fetcher: async () => [record(52798, 43.9, 100, 42.872, 74.622), record(34313, 196, 400, 42.88526, 74.55434)],
  });
  const a = out.points.find((p) => p.id === 'sc-52798');
  assert.equal(a.district, 'sverdlovsky');
  assert.equal(a.neighbourhood, 'Восток-5');
  assert.equal(a.aqi, aqiFromPm25(43.9));
  assert.equal(a.pm_estimated, false);
  await assert.rejects(fetchSensorCommunity({ districts, places, fetcher: async () => [] }), /нет работающих датчиков/);
});

test('в браузере обновляются только датчики, район которых известен', () => {
  const known = [{ id: 'sc-1', source: 'sensor-community', district: 'leninsky', neighbourhood: 'A', aqi: 10 }, { id: 'om-x', source: 'open-meteo', district: 'oktyabrsky' }];
  const fresh = refreshPoints([record(1, 47, 80, 42.87, 74.6), record(99, 20, 30, 42.87, 74.6)], known);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].aqi, 129);
  assert.equal(fresh[0].district, 'leninsky');
});

const iqairBody = (aqi = 98, ts = ago(0.5)) => ({ status: 'success', data: { city: 'Bishkek', current: { pollution: { ts, aqius: aqi, mainus: 'p2', aqicn: 50, maincn: 'p2' } } } });

test('IQAir: разбор ответа, понятные ошибки, ключ не в тексте ошибки', async () => {
  const city = parseCity(iqairBody(), NOW);
  assert.equal(city.aqi, 98);
  assert.equal(city.category, 'moderate');
  assert.equal(city.source, 'iqair');
  assert.equal(city.pm25, null);
  assert.throws(() => parseCity({ status: 'fail', data: { message: 'incorrect_api_key' } }, NOW), /неверный ключ/);
  assert.throws(() => parseCity({ status: 'fail', data: { message: 'call_limit_reached' } }, NOW), /превышен лимит/);
  assert.throws(() => parseCity(iqairBody(98, ago(9)), NOW), /устаревшие/);
  assert.throws(() => parseCity({ status: 'success', data: {} }, NOW), /нет показателя/);
  let url = '';
  await fetchIqair({ key: 'K Y', nowMs: NOW, fetcher: async (u) => { url = u; return iqairBody(); } });
  assert.equal(url, 'https://api.airvisual.com/v2/city?city=Bishkek&state=Bishkek&country=Kyrgyzstan&key=K+Y');
});

const sensorPoints = (n) => ['leninsky', 'oktyabrsky', 'pervomaisky', 'sverdlovsky'].slice(0, n).map((district, i) => ({
  id: `sc-${i}`, district, neighbourhood: `N${i}`, aqi: 60 + i * 20, pm25: 20 + i, pm10: 30, timestamp: ago(0), source: 'sensor-community',
}));
const meteo = { points: [{ id: 'om-a', district: 'leninsky', neighbourhood: 'A', aqi: 55, pm25: 9, pm10: 9, timestamp: ago(0), source: 'open-meteo' }], history: { city: [], points: {} } };
const failing = async () => { throw new SourceError('HTTP 500'); };
const run = (deps, extra = {}) => updateAir({ prev: null, iqairKey: 'k', districts, places, nowMs: NOW, deps: { fetchOpenMeteo: async () => meteo, ...deps }, ...extra });
const iqairCity = () => parseCity(iqairBody(), NOW);

test('приоритет: IQAir для города, датчики для карты, IQAir не попадает в историю', async () => {
  const out = await run({ fetchIqair: async () => iqairCity(), fetchSensorCommunity: async () => ({ points: sensorPoints(4) }) });
  assert.equal(out.source, 'iqair');
  assert.equal(out.city.aqi, 98);
  assert.equal(out.districts_source, 'sensor-community');
  assert.equal(out.districts_comparable, true);
  assert.equal(out.station_check.aqi, 90);
  assert.equal(out.model_check.aqi, 55);
  const stored = JSON.stringify(out.history);
  assert.ok(!stored.includes('98'), 'значения IQAir нет в истории');
  assert.equal(out.history.city.at(-1)[1], 90);
  assert.equal(out.history.city.at(-1)[4], 's');
});

test('без ключа IQAir главной становится медиана датчиков', async () => {
  const out = await run({ fetchSensorCommunity: async () => ({ points: sensorPoints(4) }) }, { iqairKey: '' });
  assert.equal(out.status.iqair, 'нет ключа');
  assert.equal(out.source, 'sensor-community');
  assert.equal(out.city.stations, 4);
});

test('меньше трёх датчиков: город по модели, но карта по датчикам', async () => {
  const out = await run({ fetchSensorCommunity: async () => ({ points: sensorPoints(2) }) }, { iqairKey: '' });
  assert.equal(out.source, 'open-meteo');
  assert.equal(out.station_check, null);
  assert.equal(out.districts_source, 'sensor-community');
  assert.equal(out.districts.leninsky.aqi, 60);
  assert.equal(out.districts.sverdlovsky.aqi, null);
  assert.equal(out.history.city.at(-1)[4], 'm');
});

test('один датчик: районы сравнивать нельзя', async () => {
  const out = await run({ fetchSensorCommunity: async () => ({ points: sensorPoints(1) }) }, { iqairKey: '' });
  assert.equal(out.districts_comparable, false);
});

test('сбой IQAir не мешает, а сбой всего оставляет прошлые данные', async () => {
  const first = await run({ fetchIqair: failing, fetchSensorCommunity: async () => ({ points: sensorPoints(3) }) });
  assert.match(first.status.iqair, /^ошибка: HTTP 500/);
  assert.equal(first.source, 'sensor-community');
  const second = await updateAir({ prev: first, iqairKey: 'k', districts, places, nowMs: NOW + 1800e3, deps: { fetchIqair: failing, fetchSensorCommunity: failing, fetchOpenMeteo: failing } });
  assert.equal(second.city.aqi, first.city.aqi);
  assert.equal(second.generated_at, first.generated_at);
});

test('только IQAir: цифра есть, история не растёт', async () => {
  const out = await updateAir({ prev: null, iqairKey: 'k', districts, places, nowMs: NOW, deps: { fetchIqair: async () => iqairCity(), fetchSensorCommunity: failing, fetchOpenMeteo: failing } });
  assert.equal(out.city.aqi, 98);
  assert.deepEqual(out.history.city, []);
  assert.equal(out.districts.leninsky.aqi, null);
});

const iqairFile = (hours) => ({ city: { aqi: 98, timestamp: ago(hours), source: 'iqair' }, districts: { x: { aqi: 1 } }, districts_source: 'sensor-community', districts_comparable: true, station_check: { aqi: 70 }, model_check: { aqi: 55 } });
const liveSensors = { city: { aqi: 80, timestamp: ago(0), source: 'sensor-community', stations: 3 }, districts: { x: { aqi: 2 } }, comparable: true };
const liveModel = { city: { aqi: 60, timestamp: ago(0), source: 'open-meteo' }, districts: { x: { aqi: 3 } } };

test('свежий IQAir крупно, карта и сравнение по живым датчикам', () => {
  const r = chooseReading({ file: iqairFile(1), live: liveModel, liveSensors, nowMs: NOW });
  assert.equal(r.mode, 'iqair');
  assert.equal(r.city.aqi, 98);
  assert.equal(r.districts.x.aqi, 2);
  assert.equal(r.districtsSource, 'sensor-community');
  assert.equal(r.stationCheck.aqi, 80);
  assert.equal(r.modelCheck.aqi, 60);
  assert.equal(r.notice, null);
});

test('живые датчики не загрузились: карта и сравнение из файла', () => {
  const r = chooseReading({ file: iqairFile(1), live: null, liveSensors: null, nowMs: NOW });
  assert.equal(r.districts.x.aqi, 1);
  assert.equal(r.stationCheck.aqi, 70);
  assert.equal(r.modelCheck.aqi, 55);
});

test('IQAir устарел: датчики с пометкой о времени', () => {
  const r = chooseReading({ file: iqairFile(5), live: liveModel, liveSensors, nowMs: NOW });
  assert.equal(r.mode, 'community');
  assert.equal(r.city.aqi, 80);
  assert.equal(r.notice.key, 'notice.iqair_stale');
  assert.equal(r.notice.time, ago(5));
});

test('IQAir устарел и датчиков нет: модель с пометкой', () => {
  const r = chooseReading({ file: iqairFile(5), live: liveModel, liveSensors: null, nowMs: NOW });
  assert.equal(r.mode, 'model');
  assert.equal(r.notice.key, 'notice.iqair_stale_model');
  assert.equal(r.districtsSource, 'open-meteo');
});

test('только два живых датчика: город не считаем, но карта ими обновляется', () => {
  const few = { city: null, districts: { x: { aqi: 9 } }, comparable: true };
  const r = chooseReading({ file: iqairFile(1), live: liveModel, liveSensors: few, nowMs: NOW });
  assert.equal(r.mode, 'iqair');
  assert.equal(r.districts.x.aqi, 9);
  const noIqair = chooseReading({ file: { city: { aqi: 55, timestamp: ago(1), source: 'open-meteo' } }, live: liveModel, liveSensors: few, nowMs: NOW });
  assert.equal(noIqair.mode, 'model');
});

const airFor = (source, districtsSource) => ({
  source,
  districts_source: districtsSource,
  districts_comparable: true,
  city: { aqi: 120, timestamp: new Date(NOW).toISOString() },
  districts: { a: { name: 'Ленинский', aqi: 90 }, b: { name: 'Первомайский', aqi: 140 } },
});

test('утренний пост: IQAir назван как источник, датчики жителей помечены как ориентир', () => {
  const iqair = morningPost(airFor('iqair', 'sensor-community'), 'https://x/', NOW);
  assert.match(iqair, /Данные: IQAir/);
  assert.match(iqair, /По датчикам жителей хуже всего: Первомайский/);
  const community = morningPost(airFor('sensor-community', 'sensor-community'), 'https://x/', NOW);
  assert.match(community, /датчики жителей, ориентировочно/);
  assert.doesNotMatch(community, /Данные: IQAir/);
});
