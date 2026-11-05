import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clock, dayMonth, dayMonthYear, fullDate, weekdayShort } from '../assets/dates.js';
import { strings } from '../assets/i18n.js';
import { LEVELS } from '../assets/levels.js';

const pages = readdirSync('.').filter((f) => f.endsWith('.html'));

test('в обоих языках одинаковый набор строк', () => {
  const ru = Object.keys(strings.ru).sort();
  const ky = Object.keys(strings.ky).sort();
  assert.deepEqual(ru.filter((k) => !ky.includes(k)), []);
  assert.deepEqual(ky.filter((k) => !ru.includes(k)), []);
});

test('подстановки {имя} совпадают в обоих языках', () => {
  const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const key of Object.keys(strings.ru)) assert.equal(vars(strings.ky[key]), vars(strings.ru[key]), key);
});

test('для каждого уровня и группы есть совет', () => {
  for (const group of ['children', 'pregnant', 'elderly', 'sport', 'windows', 'masks']) {
    for (const { key } of LEVELS) assert.ok(strings.ru[`advice.${group}.${key}`], `${group}.${key}`);
  }
});

test('текст в HTML совпадает со строкой из i18n, ключи существуют', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    for (const [, key, text] of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
      assert.ok(key in strings.ru, `${page}: нет ключа ${key}`);
      assert.equal(text, strings.ru[key], `${page}: ${key}`);
    }
  }
});

test('в текстах нет длинного тире', () => {
  for (const lang of ['ru', 'ky']) {
    for (const [key, value] of Object.entries(strings[lang])) assert.ok(!value.includes('—'), `${lang}:${key}`);
  }
  for (const page of pages) assert.ok(!readFileSync(page, 'utf8').includes('—'), page);
});

test('у каждой страницы есть превью для соцсетей с абсолютной ссылкой', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/assets\/og\.png">/, page);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, page);
    assert.match(html, /<meta property="og:description" content="[^"]+">/, page);
  }
});

test('даты: время Бишкека и названия без помощи браузера', () => {
  const ms = Date.parse('2026-11-05T20:30:00Z'); // в Бишкеке уже 6 ноября, 02:30
  assert.equal(clock(ms), '02:30');
  assert.equal(dayMonth(ms, 'ru'), '6 ноября');
  assert.equal(dayMonth(ms, 'ky'), '6-ноябрь');
  assert.equal(fullDate(ms, 'ru'), 'пятница, 6 ноября');
  assert.equal(fullDate(ms, 'ky'), 'жума, 6-ноябрь');
  assert.equal(weekdayShort(ms, 'ru'), 'пт');
  assert.equal(dayMonthYear(ms, 'ru'), '6 ноября 2026');
  assert.equal(weekdayShort(Date.parse('2026-11-08T12:00:00Z'), 'ru'), 'вс');
});
