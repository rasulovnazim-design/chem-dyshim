import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseReading } from '../assets/freshness.js';

const NOW = Date.parse('2026-11-05T04:00:00Z');
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();
const file = (source, ageHours, aqi = 150) => ({ city: { aqi, timestamp: ago(ageHours), source, stations: 3 }, districts: {}, districts_comparable: source === 'waqi' });
const live = { city: { aqi: 60, timestamp: ago(0), source: 'open-meteo' }, districts: {} };

test('свежие датчики важнее модели, модель показывается для сравнения', () => {
  const r = chooseReading({ file: file('waqi', 0.5), live, nowMs: NOW });
  assert.equal(r.mode, 'sensors');
  assert.equal(r.city.aqi, 150);
  assert.equal(r.modelCheck.aqi, 60);
  assert.equal(r.notice, null);
});

test('датчики замолчали: показываем модель и последнее время датчиков', () => {
  const r = chooseReading({ file: file('waqi', 5), live, nowMs: NOW });
  assert.equal(r.mode, 'model');
  assert.equal(r.city.aqi, 60);
  assert.equal(r.notice.key, 'notice.stale_file');
  assert.equal(r.notice.time, ago(5));
  assert.equal(r.comparable, false);
});

test('файла нет: живой расчёт с пометкой', () => {
  const r = chooseReading({ file: null, live, nowMs: NOW });
  assert.equal(r.city.aqi, 60);
  assert.equal(r.notice.key, 'notice.no_file');
});

test('файл на резерве и свежий: показываем более новый живой расчёт без тревоги', () => {
  const r = chooseReading({ file: file('open-meteo', 1, 55), live, nowMs: NOW });
  assert.equal(r.city.aqi, 60);
  assert.equal(r.notice, null);
});

test('файл устарел и живого расчёта нет: последнее известное значение и предупреждение', () => {
  const r = chooseReading({ file: file('waqi', 30), live: null, nowMs: NOW });
  assert.equal(r.city.aqi, 150);
  assert.equal(r.notice.key, 'notice.stale');
  assert.equal(r.notice.time, ago(30));
});

test('файла и сети нет: то, что сохранено на устройстве', () => {
  const r = chooseReading({ file: null, live: null, cached: { city: { aqi: 99, timestamp: ago(40), source: 'open-meteo' }, districts: {} }, nowMs: NOW });
  assert.equal(r.city.aqi, 99);
  assert.equal(r.notice.key, 'notice.cached');
});

test('ничего нет: честное сообщение и никаких цифр', () => {
  const r = chooseReading({ file: null, live: null, cached: null, nowMs: NOW });
  assert.equal(r.mode, 'none');
  assert.equal(r.city, null);
  assert.equal(r.notice.key, 'notice.no_data');
});

test('битый файл не роняет выбор', () => {
  for (const bad of [{}, { city: null }, { city: { aqi: 'x' } }, { city: { aqi: 10 } }]) {
    assert.equal(chooseReading({ file: bad, live: null, nowMs: NOW }).mode, 'none');
  }
});
