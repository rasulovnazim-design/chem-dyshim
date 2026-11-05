// Формулы калькуляторов. Отдельный файл, чтобы их можно было проверить тестами.

// Очистители: 5 смен воздуха в час это ориентир CDC и Гарварда.
// При потолке 2,4 м он почти совпадает с правилом 2/3 EPA и AHAM (около 12 м³/ч на м²).
export const ACH_MINIMUM = 5;
// Правило AHAM для дыма лесных пожаров: CADR в cfm равен площади в ft². Это около 18,3 м³/ч на м² при потолке 2,4 м.
// Применять его к зимнему смогу предлагаем мы, это аналогия, а не совет AHAM.
export const ACH_SMOG = 7.6;

export function requiredCadr(areaM2, heightM, ach = ACH_MINIMUM) {
  if (!(areaM2 > 0) || !(heightM > 0)) return null;
  return Math.ceil((areaM2 * heightM * ach) / 10) * 10;
}

/** Сколько квадратных метров прибор очищает при 5 сменах воздуха и потолке 2,4 м. */
export function roomForCadr(cadr, heightM = 2.4, ach = ACH_MINIMUM) {
  if (!(cadr > 0)) return null;
  return Math.round(cadr / (heightM * ach));
}

/** Модели, которым хватает мощности, от самой дешёвой. Учитывается меньшая из опубликованных цифр CADR. */
export function suitablePurifiers(purifiers, needed) {
  const available = (p) => p.listings.filter((l) => l.stock !== 'out');
  return purifiers
    .filter((p) => p.cadr && !p.cadr.optionalFilter && p.cadr.min >= needed && available(p).length)
    .map((p) => ({ ...p, fromPrice: Math.min(...available(p).map((l) => l.price)) }))
    .sort((a, b) => a.fromPrice - b.fromPrice);
}

export function priceRange(listings) {
  const prices = listings.filter((l) => l.stock !== 'out').map((l) => l.price);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
}

// Отопление

export function monthlyBill(kwh, tariff) {
  return Math.min(kwh, tariff.thresholdKwh) * tariff.low + Math.max(kwh - tariff.thresholdKwh, 0) * tariff.high;
}

/** Прибавка к счетам за сезон: ступень тарифа считается помесячно, поверх обычного расхода дома. */
export function seasonCost(heatingKwh, { tariff, monthShares, baseKwhPerMonth }) {
  return Object.values(monthShares).reduce(
    (sum, share) => sum + monthlyBill(baseKwhPerMonth + heatingKwh * share, tariff) - monthlyBill(baseKwhPerMonth, tariff),
    0,
  );
}

const pumpCosts = (heatKwh, pump, costOf) => ({
  mid: costOf(heatKwh / pump.cop),
  low: costOf(heatKwh / pump.copHigh),
  high: costOf(heatKwh / pump.copLow),
});

/**
 * Две разные оценки. «Как сейчас»: то же тепло, что дома получают от угля; обычно дом при этом недотоплен.
 * «Весь дом в тепле»: тепло во всех комнатах при данном утеплении.
 */
export function heatingEstimate({ area, coalSpend, insulation }, cfg) {
  if (!(area > 0) || !(coalSpend >= 0) || !(insulation in cfg.demand)) return null;
  const costOf = (kwh) => seasonCost(kwh, { tariff: cfg.tariff, monthShares: cfg.climate.monthShares, baseKwhPerMonth: cfg.baseKwhPerMonth });
  const tonnes = coalSpend / cfg.coal.pricePerTonne;
  const heatNow = tonnes * 1000 * cfg.coal.kwhPerKg * cfg.coal.stoveEfficiency;
  const heatFull = area * cfg.demand[insulation];
  // Коэффициент теплопотерь: сезонная потребность, делённая на градусо-часы, умноженный на разницу температур в мороз
  const peakFactor = (cfg.climate.indoorC - cfg.climate.designC) / (cfg.climate.degreeDays * 24);
  const power = (heat) => ({ direct: heat * peakFactor, pump: (heat * peakFactor) / cfg.pump.copCold });
  return {
    tonnes,
    heatNow,
    heatFull,
    direct: { now: costOf(heatNow), full: costOf(heatFull) },
    pump: { now: pumpCosts(heatNow, cfg.pump, costOf), full: pumpCosts(heatFull, cfg.pump, costOf) },
    power: { now: power(heatNow), full: power(heatFull) },
  };
}

/** Предупреждения о лимите. Цена без них вводила бы в заблуждение: столько мощности дому просто не дадут. */
export function powerWarnings(estimate, limits) {
  const warnings = [];
  const { direct, pump } = estimate.power.full;
  if (direct > limits.threePhaseKw) warnings.push({ key: 'heat.warn_direct_three', kw: direct });
  else if (direct > limits.singlePhaseKw) warnings.push({ key: 'heat.warn_direct_single', kw: direct });
  if (pump > limits.singlePhaseKw) warnings.push({ key: 'heat.warn_pump_over', kw: pump });
  else if (pump > limits.peakSinglePhaseKw) warnings.push({ key: 'heat.warn_pump_peak', kw: pump });
  return warnings;
}

/** Ссылки для заявки. Текст подставляется в сообщение, которое человек отправляет сам. */
export function leadLinks(contact, text) {
  const username = String(contact?.telegram ?? '').trim().replace(/^@/, '');
  const phone = String(contact?.whatsapp ?? '').replace(/\D/g, '');
  const encoded = encodeURIComponent(text);
  return {
    telegram: /^[A-Za-z0-9_]{4,}$/.test(username) ? `https://t.me/${username}?text=${encoded}` : null,
    whatsapp: phone.length >= 9 ? `https://wa.me/${phone}?text=${encoded}` : null,
  };
}
