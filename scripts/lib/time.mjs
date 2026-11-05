// Время Бишкека: UTC+6 круглый год, переходов на летнее время нет.
import { dayMonth } from '../../assets/dates.js';

export const bishkekDateLong = (ms) => dayMonth(ms, 'ru');
const OFFSET_MS = 6 * 3600e3;
const shifted = (ms) => new Date(ms + OFFSET_MS);

export const bishkekDate = (ms) => shifted(ms).toISOString().slice(0, 10);
export const bishkekHour = (ms) => shifted(ms).getUTCHours();
export const bishkekClock = (ms) => shifted(ms).toISOString().slice(11, 16);

