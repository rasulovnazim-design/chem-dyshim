// Даты по времени Бишкека (UTC+6 круглый год). Названия месяцев и дней лежат в i18n.js,
// поэтому результат не зависит от того, какие языки поддерживает браузер.
import { DATE_NAMES } from './i18n.js';

const OFFSET_MS = 6 * 3600e3;
const pad = (n) => String(n).padStart(2, '0');

function parts(ms) {
  const d = new Date(ms + OFFSET_MS);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    weekday: (d.getUTCDay() + 6) % 7, // понедельник первый
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function clock(ms) {
  const { hour, minute } = parts(ms);
  return `${pad(hour)}:${pad(minute)}`;
}

export function dayMonth(ms, lang = 'ru') {
  const { day, month } = parts(ms);
  const name = DATE_NAMES[lang].months[month];
  return lang === 'ky' ? `${day}-${name}` : `${day} ${name}`;
}

export function fullDate(ms, lang = 'ru') {
  return `${DATE_NAMES[lang].weekdays[parts(ms).weekday]}, ${dayMonth(ms, lang)}`;
}

export const weekdayShort = (ms, lang = 'ru') => DATE_NAMES[lang].weekdaysShort[parts(ms).weekday];

export const dayMonthYear = (ms, lang = 'ru') => `${dayMonth(ms, lang)} ${parts(ms).year}`;
