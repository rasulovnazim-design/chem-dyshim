// Шкала AQI США. Один файл для сайта, скриптов и рассылки.
// Цвета подобраны так, чтобы читаться на белом фоне (контраст не ниже 4.5:1).
export const LEVELS = [
  { key: 'good', max: 50, color: '#1B7A3D', dot: '🟢' },
  { key: 'moderate', max: 100, color: '#8A6A00', dot: '🟡' },
  { key: 'sensitive', max: 150, color: '#B8520A', dot: '🟠' },
  { key: 'unhealthy', max: 200, color: '#B3261E', dot: '🔴' },
  { key: 'very', max: 300, color: '#6D2C91', dot: '🟣' },
  { key: 'hazardous', max: Infinity, color: '#6B1426', dot: '🟤' },
];

export const NEUTRAL_COLOR = '#5A5A55';

export function levelIndex(aqi) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi) || aqi < 0) return -1;
  return LEVELS.findIndex((l) => aqi <= l.max);
}

export const levelOf = (aqi) => LEVELS[levelIndex(aqi)] ?? null;

// Индекс уровня «вредно»: с него начинаются тревожные сообщения в канале.
export const ALERT_LEVEL_INDEX = 3;
