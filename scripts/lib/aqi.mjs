// Перевод AQI в концентрацию и сводка по точкам.
import { levelOf } from '../../assets/levels.js';

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
