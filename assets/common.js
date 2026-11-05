// Общее для всех страниц: язык, акцентный цвет, форматирование времени Бишкека.
import { clock, dayMonth, dayMonthYear, fullDate, weekdayShort } from './dates.js';
import { DEFAULT_LANG, strings } from './i18n.js';
import { levelOf, NEUTRAL_COLOR } from './levels.js';

const LANG_KEY = 'cd-lang';
const ACCENT_KEY = 'cd-accent';
const NOW_MAX_AGE_MS = 6 * 3600e3;

export function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим: без запоминания */ }
}
export function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export let lang = recall(LANG_KEY) === 'ky' ? 'ky' : DEFAULT_LANG;

export function t(key, vars = {}) {
  const s = strings[lang][key] ?? strings.ru[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export const fmtClock = (ms) => clock(ms);
export const fmtDay = (ms) => dayMonth(ms, lang);
export const fmtWeekday = (ms) => weekdayShort(ms, lang);
export const fmtFullDate = (ms) => fullDate(ms, lang);
export const fmtDayYear = (ms) => dayMonthYear(ms, lang);
export const fmtDayClock = (ms) => `${fmtDay(ms)}, ${fmtClock(ms)}`;
// В кыргызском те же разделители чисел, что и в русском: пробел и запятая
export const fmtNumber = (n, digits = 0) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);

export function setAccent(aqi) {
  const color = levelOf(aqi)?.color ?? NEUTRAL_COLOR;
  document.documentElement.style.setProperty('--accent', color);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  store(ACCENT_KEY, color);
}

export function applyStrings(root = document) {
  document.documentElement.lang = lang === 'ky' ? 'ky' : 'ru';
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  const titleKey = document.documentElement.dataset.title;
  if (titleKey) document.title = `${t(titleKey)}. ${t('site.name')}`;
  const dateline = document.getElementById('dateline-date');
  if (dateline) dateline.textContent = `${t('dateline.city')}, ${fmtFullDate(Date.now())}`;
}

/** Обратный отсчёт от времени чтения файла: GitHub Pages кэширует 10 минут, поэтому адрес меняется раз в 5 минут. */
export function dataUrl(path) {
  return `${path}?t=${Math.floor(Date.now() / 300000)}`;
}

export async function fetchJson(url, timeoutMs = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function loadEar() {
  const ear = document.getElementById('ear');
  try {
    const now = await fetchJson(dataUrl('data/now.json'));
    if (Date.now() - Date.parse(now.timestamp) > NOW_MAX_AGE_MS) return;
    setAccent(now.aqi);
    if (ear) {
      ear.textContent = t('ear', { aqi: now.aqi });
      ear.hidden = false;
    }
  } catch {
    // Без файла шапка просто остаётся без цифры
  }
}

export function initPage({ onLangChange, ear = true } = {}) {
  const remembered = recall(ACCENT_KEY);
  if (remembered) document.documentElement.style.setProperty('--accent', remembered);
  applyStrings();
  document.getElementById('lang-toggle')?.addEventListener('click', () => {
    lang = lang === 'ru' ? 'ky' : 'ru';
    store(LANG_KEY, lang);
    applyStrings();
    onLangChange?.();
    if (ear) loadEar();
  });
  if (ear) loadEar();
}
