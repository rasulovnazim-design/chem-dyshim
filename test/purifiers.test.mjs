import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceRange, requiredCadr, roomForCadr, suitablePurifiers } from '../assets/calc.js';
import { PURIFIERS } from '../config/purifiers.js';
import { LINKS, SHOPS } from '../config/shops.js';

test('минимальный CADR: 5 смен воздуха, округление вверх до десятков', () => {
  assert.equal(requiredCadr(20, 2.4), 240);
  assert.equal(requiredCadr(30, 2.4), 360);
  assert.equal(requiredCadr(20, 2.7), 270);
  assert.equal(requiredCadr(0, 2.7), null);
  assert.equal(requiredCadr(20, 0), null);
  assert.equal(requiredCadr(Number.NaN, 2.7), null);
});

test('обратный расчёт совпадает с опубликованным в исследовании', () => {
  assert.equal(roomForCadr(360), 30);
  assert.equal(roomForCadr(200), 17);
  assert.equal(roomForCadr(null), null);
});

test('подбор: дешёвые вперёд, модели без CADR и с необязательным фильтром не предлагаются', () => {
  const names = suitablePurifiers(PURIFIERS, 360).map((p) => p.id);
  assert.equal(names[0], 'xiaomi-4-lite');
  for (const id of ['ballu-ap130', 'sharp-j31rb', 'mijia-6-dual', 'mijia-6-max', 'harper-kc21']) assert.ok(!names.includes(id), id);
  assert.deepEqual(suitablePurifiers(PURIFIERS, 5000), []);
});

test('цена: только то, что можно купить', () => {
  assert.deepEqual(priceRange([{ price: 10, stock: 'in' }, { price: 20, stock: 'order' }, { price: 5, stock: 'out' }]), { min: 10, max: 20 });
  assert.equal(priceRange([{ price: 5, stock: 'out' }]), null);
});

test('у каждого предложения есть рабочая запись в конфиге ссылок', () => {
  const used = new Set();
  for (const p of PURIFIERS) {
    for (const item of [...p.listings, ...p.filter.links]) {
      assert.ok(SHOPS[item.shop], `${p.id}: магазин ${item.shop}`);
      assert.match(LINKS[item.link] ?? '', /^https:\/\//, `${p.id}: ссылка ${item.link}`);
      used.add(item.link);
    }
  }
  assert.deepEqual(Object.keys(LINKS).filter((k) => !used.has(k)), [], 'лишних ссылок нет');
});

test('в списке нет сомнительных адресов и длинного тире', () => {
  const all = JSON.stringify({ PURIFIERS, LINKS, SHOPS });
  assert.ok(!all.includes('mistore.kg'), 'mistore.kg ведёт на сайт ставок');
  assert.ok(!all.includes('—'));
  for (const p of PURIFIERS) assert.ok(p.listings.some((l) => l.stock !== 'out'), `${p.id}: должно быть хотя бы одно предложение`);
});
