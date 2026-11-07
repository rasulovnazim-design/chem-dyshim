// Перевод AQI в концентрацию и сводка по точкам.
import { levelOf } from '../../assets/levels.js';
import { DISTRICT_IDS } from '../../config/sources.js';

// WAQI отдаёт по загрязнителям не мкг/м³, а суб-индекс AQI, поэтому концентрацию
// приходится восстанавливать обратным расчётом. Это приближение, на сайте оно
// помечено знаком ≈. Таблицы EPA: [AQI от, AQI до, концентрация от, концентрация до].
const PM25 = [
  [0, 50, 0, 12], [51, 100, 12.1, 35.4], [101, 150, 35.5, 55.4], [151, 200, 55.5, 150.4],
  [201, 300, 150.5, 250.4], [301, 400, 250.5, 350.4], [401, 500, 350.5, 500.4],
];
const PM10 = [
  [0, 50, 0, 54], [51, 100, 55, 154], [101, 150, 155, 254], [151, 200, 255, 354],
  [201, 300, 355, 424], [301, 400, 425, 504], [401, 500, 505, 604],
];

function invert(aqi, table) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi) || aqi < 0) return null;
  const clamped = Math.min(aqi, 500);
  const band = table.find(([, hi]) => clamped <= hi) ?? table[table.length - 1];
  const [aLo, aHi, cLo, cHi] = band;
  const within = aHi === aLo ? 0 : (Math.max(clamped, aLo) - aLo) / (aHi - aLo);
  return Math.round((cLo + within * (cHi - cLo)) * 10) / 10;
}

// Прямой расчёт для датчиков, которые дают мкг/м³: таблица EPA в редакции 2024 года.
const PM25_2024 = [
  [0, 50, 0, 9], [51, 100, 9.1, 35.4], [101, 150, 35.5, 55.4], [151, 200, 55.5, 125.4],
  [201, 300, 125.5, 225.4], [301, 500, 225.5, 325.4],
];

export function aqiFromPm25(concentration) {
  if (typeof concentration !== 'number' || !Number.isFinite(concentration) || concentration < 0) return null;
  const c = Math.floor(concentration * 10) / 10; // EPA отбрасывает знаки после первого
  const band = PM25_2024.find(([, , , cHi]) => c <= cHi) ?? PM25_2024[PM25_2024.length - 1];
  const [aLo, aHi, cLo, cHi] = band;
  return Math.round(aLo + ((Math.min(c, cHi) - cLo) / (cHi - cLo)) * (aHi - aLo));
}

export const pm25FromAqi = (aqi) => invert(aqi, PM25);
export const pm10FromAqi = (aqi) => invert(aqi, PM10);

export function median(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

/** Сводка по набору точек. Медиана, чтобы один сбойный датчик не менял картину города. */
export function summarise(points, source) {
  const valid = points.filter((p) => typeof p.aqi === 'number');
  if (!valid.length) return null;
  const aqi = Math.round(median(valid.map((p) => p.aqi)));
  const timestamp = valid.map((p) => p.timestamp).filter(Boolean).sort().at(-1) ?? null;
  return {
    aqi,
    pm25: round1(median(valid.map((p) => p.pm25))),
    pm10: round1(median(valid.map((p) => p.pm10))),
    category: levelOf(aqi)?.key ?? null,
    timestamp,
    source,
    stations: valid.length,
  };
}

/** Сводка по каждому району. Если в районе нет точек, значения остаются пустыми: мы их не угадываем. */
export function districtSummaries(points, source, districts = []) {
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

/** Сравнивать районы можно только при данных хотя бы по двум. */
export const comparableDistricts = (districts) => Object.values(districts).filter((d) => typeof d.aqi === 'number').length >= 2;
