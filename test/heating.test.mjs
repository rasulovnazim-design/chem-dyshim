import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heatingEstimate, leadLinks, monthlyBill, powerWarnings, seasonCost } from '../assets/calc.js';
import { BASE_KWH_PER_MONTH, CLIMATE, COAL, DEMAND, HEAT_PUMP, LIMITS, TARIFF } from '../config/tariffs.js';

const CFG = { tariff: TARIFF, coal: COAL, demand: DEMAND, pump: HEAT_PUMP, climate: CLIMATE, baseKwhPerMonth: BASE_KWH_PER_MONTH };

test('счёт за месяц: ступень срабатывает выше 700 кВт·ч', () => {
  assert.equal(monthlyBill(0, TARIFF), 0);
  assert.equal(Math.round(monthlyBill(700, TARIFF)), 1148);
  assert.equal(Math.round(monthlyBill(1000, TARIFF)), 2030);
});

test('доли месяцев дают 100%', () => {
  const sum = Object.values(CLIMATE.monthShares).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('совпадает с порядком официальной оценки: около 39 000 сом за электрообогрев 100 м²', () => {
  // Обратный расчёт исследования: 14 800 кВт·ч без прочего потребления
  const cost = seasonCost(14800, { tariff: TARIFF, monthShares: CLIMATE.monthShares, baseKwhPerMonth: 0 });
  assert.ok(Math.abs(cost - 39000) < 1500, `получилось ${cost}`);
});

test('прочее потребление занимает дешёвую ступень и делает отопление дороже', () => {
  const opts = { tariff: TARIFF, monthShares: CLIMATE.monthShares };
  assert.ok(seasonCost(5000, { ...opts, baseKwhPerMonth: 300 }) > seasonCost(5000, { ...opts, baseKwhPerMonth: 0 }));
});

test('оценка для типичного дома', () => {
  const e = heatingEstimate({ area: 105, coalSpend: 28000, insulation: 'none' }, CFG);
  assert.equal(e.tonnes, 4);
  assert.equal(Math.round(e.heatNow), 6600);
  assert.equal(e.heatFull, 29925);
  // Насос дешевле прямого обогрева, диапазон упорядочен
  assert.ok(e.pump.full.mid < e.direct.full);
  assert.ok(e.pump.full.low < e.pump.full.mid && e.pump.full.mid < e.pump.full.high);
  assert.ok(e.direct.now < e.direct.full);
  // Мощность: 100 м² без утепления около 16 кВт
  const hundred = heatingEstimate({ area: 100, coalSpend: 0, insulation: 'none' }, CFG);
  assert.ok(Math.abs(hundred.power.full.direct - 15.8) < 0.1);
});

test('утепление снижает и деньги, и мощность', () => {
  const at = (insulation) => heatingEstimate({ area: 100, coalSpend: 28000, insulation }, CFG);
  assert.ok(at('good').direct.full < at('partial').direct.full);
  assert.ok(at('partial').direct.full < at('none').direct.full);
  assert.ok(at('good').power.full.direct < at('none').power.full.direct);
  assert.equal(at('none').heatNow, at('good').heatNow, 'оценка «как сейчас» от утепления не зависит');
});

test('плохие значения не считаются', () => {
  for (const bad of [
    { area: 0, coalSpend: 1, insulation: 'none' },
    { area: Number.NaN, coalSpend: 1, insulation: 'none' },
    { area: 10, coalSpend: -1, insulation: 'none' },
    { area: 10, coalSpend: 1, insulation: 'toString' },
  ]) {
    if (bad.insulation === 'toString') assert.ok(heatingEstimate({ ...bad, insulation: 'x' }, CFG) === null);
    else assert.equal(heatingEstimate(bad, CFG), null);
  }
  assert.ok(heatingEstimate({ area: 10, coalSpend: 0, insulation: 'good' }, CFG));
});

test('предупреждения о лимите соответствуют мощности', () => {
  const keys = (area, insulation) => powerWarnings(heatingEstimate({ area, coalSpend: 0, insulation }, CFG), LIMITS).map((w) => w.key);
  assert.deepEqual(keys(105, 'none'), ['heat.warn_direct_three', 'heat.warn_pump_over']);
  assert.deepEqual(keys(100, 'partial'), ['heat.warn_direct_single', 'heat.warn_pump_peak']);
  assert.deepEqual(keys(60, 'good'), []);
});

test('ссылки заявки: текст закодирован, пустой контакт не даёт ссылку', () => {
  const text = 'Площадь: 105 м²\nИмя: Айдай & Co';
  const a = leadLinks({ telegram: '@some_user', whatsapp: '+996 700 123-456' }, text);
  assert.equal(a.telegram, `https://t.me/some_user?text=${encodeURIComponent(text)}`);
  assert.equal(a.whatsapp, `https://wa.me/996700123456?text=${encodeURIComponent(text)}`);
  assert.deepEqual(leadLinks({ telegram: '', whatsapp: '' }, text), { telegram: null, whatsapp: null });
  assert.equal(leadLinks({ telegram: 'bad name!' }, text).telegram, null);
  assert.equal(leadLinks(undefined, text).whatsapp, null);
});
