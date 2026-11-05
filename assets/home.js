import { applyStrings, dataUrl, fetchJson, fmtDay, fmtClock, initPage, recall, setAccent, store, t } from './common.js';
import { renderDayChart, renderWeekChart } from './charts.js';
import { chooseReading } from './freshness.js';
import { LEVELS, levelIndex, levelOf } from './levels.js';
import { SITE } from '../config/site.js';
import { DISTRICT_IDS, FALLBACK_POINTS } from '../config/sources.js';
import { summarise } from '../scripts/lib/aqi.mjs';
import { buildUrl, parseCurrent, parseHourly } from '../scripts/lib/openmeteo.mjs';

const CACHE_KEY = 'cd-last';
const GROUPS = ['children', 'pregnant', 'elderly', 'sport', 'windows', 'masks'];
const $ = (id) => document.getElementById(id);

const state = { file: null, live: null, cached: null, liveHistory: null, reading: null, level: null };

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function liveFromBody(body) {
  const points = parseCurrent(body, FALLBACK_POINTS);
  if (!points.length) return null;
  const city = summarise(points, 'open-meteo');
  const districts = Object.fromEntries(DISTRICT_IDS.map((id) => {
    const own = points.filter((p) => p.district === id);
    return [id, { ...(summarise(own, 'open-meteo') ?? { aqi: null }), neighbourhoods: own.map((p) => p.neighbourhood) }];
  }));
  return { city, districts };
}

function setText(id, text) {
  const node = $(id);
  node.textContent = text ?? '';
  node.hidden = !text;
}

function renderLead() {
  const { reading } = state;
  const { city } = reading;
  $('hero-number').textContent = city ? String(city.aqi) : '–';
  $('hero-category').textContent = city ? t(`level.${levelOf(city.aqi).key}`) : t('level.unknown');
  setAccent(city?.aqi);

  if (city) {
    const ms = Date.parse(city.timestamp);
    setText('reading-time', capitalise(t('home.reading_time', { time: fmtClock(ms), date: fmtDay(ms) })));
    const fmtPm = (v) => (typeof v === 'number' ? String(Math.round(v)) : '?');
    const estimated = reading.mode === 'sensors';
    setText('reading-source', reading.mode === 'sensors' ? t('home.source_sensors', { n: city.stations }) : t('home.source_model'));
    setText('reading-pm', t(estimated ? 'home.pm_estimated' : 'home.pm', { pm25: fmtPm(city.pm25), pm10: fmtPm(city.pm10) }));
    setText('reading-check', reading.modelCheck ? t('home.model_check', { aqi: reading.modelCheck.aqi }) : '');
    const key = LEVELS[levelIndex(city.aqi)].key;
    setText('tip', `${t('advice.children')}: ${t(`advice.children.${key}`)}`);
  } else {
    for (const id of ['reading-time', 'reading-source', 'reading-pm', 'reading-check', 'tip']) setText(id, '');
  }
  const notice = reading.notice;
  setText('notice', notice ? t(notice.key, notice.time ? { time: `${fmtDay(Date.parse(notice.time))}, ${fmtClock(Date.parse(notice.time))}` } : {}) : '');
}

function renderSubscribe() {
  const link = $('subscribe');
  if (SITE.telegramChannel) {
    link.href = `https://t.me/${encodeURIComponent(SITE.telegramChannel)}`;
    link.textContent = t('home.subscribe');
    link.removeAttribute('aria-disabled');
  } else {
    link.removeAttribute('href');
    link.textContent = t('home.subscribe_soon');
    link.setAttribute('aria-disabled', 'true');
  }
}

function renderDistricts() {
  const { reading } = state;
  const districts = reading.districts ?? {};
  for (const id of DISTRICT_IDS) {
    const d = districts[id];
    const color = levelOf(d?.aqi)?.color ?? null;
    const shape = $(`map-${id}`);
    const hasValue = typeof d?.aqi === 'number';
    if (color) shape.style.fill = color; else shape.style.removeProperty('fill');
    const value = $(`map-value-${id}`);
    const name = $(`map-name-${id}`);
    value.textContent = hasValue ? String(d.aqi) : '–';
    name.textContent = t(`district.${id}`);

    const row = $(`row-${id}`);
    row.querySelector('.dot').style.background = color ?? '';
    row.querySelector('.name').textContent = t(`district.${id}`);
    row.querySelector('.value').textContent = hasValue ? String(d.aqi) : t('home.no_data_short');
    const places = d?.neighbourhoods ?? [];
    const sub = row.querySelector('.sub');
    const category = hasValue ? t(`level.${levelOf(d.aqi).key}`) : '';
    const list = places.length ? t('home.district_points', { list: places.join(', ') }) : '';
    sub.textContent = [category, list].filter(Boolean).join('. ');
    sub.hidden = !sub.textContent;
  }
  setText('map-note', reading.mode === 'none' ? '' : t(reading.comparable ? 'home.map_note_sensors' : 'home.map_note_model'));
}

function renderCharts() {
  const nowMs = Date.now();
  const series = state.file?.history?.city?.length ? state.file.history.city : state.liveHistory ?? [];
  renderDayChart($('chart-day-body'), series, nowMs);
  const { hasModel } = renderWeekChart($('chart-week-body'), series, nowMs) ?? {};
  setText('chart-note', hasModel ? t('home.chart_model_note') : '');
}

function renderAdvice() {
  const level = state.level ?? LEVELS[levelIndex(state.reading?.city?.aqi)]?.key ?? 'good';
  $('todo-level').textContent = t('home.todo_for_level', { level: t(`level.${level}`) });
  const list = $('advice');
  list.replaceChildren();
  for (const group of GROUPS) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = t(`advice.${group}`);
    dd.textContent = capitalise(t(`advice.${group}.${level}`));
    row.append(dt, dd);
    list.append(row);
  }
  const buttons = $('levels');
  buttons.replaceChildren();
  for (const l of LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t(`level.${l.key}`);
    b.setAttribute('aria-pressed', String(l.key === level));
    b.addEventListener('click', () => { state.level = l.key; renderAdvice(); });
    buttons.append(b);
  }
}

function render() {
  state.reading = chooseReading({ file: state.file, live: state.live, cached: state.cached, nowMs: Date.now() });
  applyStrings();
  renderLead();
  renderSubscribe();
  renderDistricts();
  renderCharts();
  renderAdvice();
  if (state.reading.city && !state.reading.notice) {
    store(CACHE_KEY, JSON.stringify({ city: state.reading.city, districts: state.reading.districts, comparable: state.reading.comparable }));
  }
}

async function start() {
  initPage({ onLangChange: render, ear: false });
  try { state.cached = JSON.parse(recall(CACHE_KEY)); } catch { state.cached = null; }
  renderSubscribe();

  const fileLoad = fetchJson(dataUrl('data/aqi.json')).then((v) => { state.file = v; }).catch(() => { state.file = null; });
  const liveLoad = fetchJson(buildUrl(FALLBACK_POINTS)).then((body) => { state.live = liveFromBody(body); }).catch(() => { state.live = null; });

  // Показываем данные файла сразу, как только они пришли, не дожидаясь второго запроса
  await fileLoad;
  if (state.file) render();
  await liveLoad;
  render();

  // Файла нет: график строим из истории модели, чтобы страница не осталась пустой
  if (!state.file?.history?.city?.length) {
    try {
      const body = await fetchJson(buildUrl(FALLBACK_POINTS, { hourly: true }), 12000);
      state.liveHistory = parseHourly(body, Date.now(), FALLBACK_POINTS).city;
      renderCharts();
    } catch {
      // Останется подпись, что данных для графика нет
    }
  }
}

start();
