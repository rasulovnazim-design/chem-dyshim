import { applyStrings, dataUrl, fetchJson, fmtDay, fmtClock, initPage, recall, setAccent, store, t } from './common.js';
import { renderDayChart, renderWeekChart } from './charts.js';
import { chooseReading } from './freshness.js';
import { LEVELS, levelIndex, levelOf } from './levels.js';
import { SITE } from '../config/site.js';
import { DISTRICT_IDS, FALLBACK_POINTS, MIN_COMMUNITY_SENSORS } from '../config/sources.js';
import { comparableDistricts, districtSummaries, summarise } from '../scripts/lib/aqi.mjs';
import { buildUrl, parseCurrent, parseHourly } from '../scripts/lib/openmeteo.mjs';
import { boxUrl, refreshPoints, SOURCE as COMMUNITY } from '../scripts/lib/sensorcommunity.mjs';

const CACHE_KEY = 'cd-last';
const GROUPS = ['children', 'pregnant', 'elderly', 'sport', 'windows', 'masks'];
const $ = (id) => document.getElementById(id);

const state = { file: null, live: null, liveSensors: null, cached: null, liveHistory: null, reading: null, level: null };

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function liveFromBody(body) {
  const points = parseCurrent(body, FALLBACK_POINTS);
  if (!points.length) return null;
  return { city: summarise(points, 'open-meteo'), districts: districtSummaries(points, 'open-meteo') };
}

function liveSensorsFromBody(body, knownPoints) {
  const points = refreshPoints(body, knownPoints);
  if (!points.length) return null;
  const districts = districtSummaries(points, COMMUNITY);
  return {
    city: points.length >= MIN_COMMUNITY_SENSORS ? summarise(points, COMMUNITY) : null,
    districts,
    comparable: comparableDistricts(districts),
  };
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
    const hasPm = typeof city.pm25 === 'number' || typeof city.pm10 === 'number';
    const sourceText = {
      iqair: () => t('home.source_iqair'),
      sensors: () => t('home.source_sensors', { n: city.stations }),
      community: () => t('home.source_community', { n: city.stations }),
      model: () => t('home.source_model'),
    }[reading.mode];
    setText('reading-source', sourceText?.() ?? '');
    setText('reading-pm', hasPm ? t(reading.mode === 'sensors' ? 'home.pm_estimated' : 'home.pm', { pm25: fmtPm(city.pm25), pm10: fmtPm(city.pm10) }) : '');
    const { stationCheck, modelCheck } = reading;
    let check = '';
    if (stationCheck && modelCheck) check = t('home.check_both', { sensors: stationCheck.aqi, model: modelCheck.aqi });
    else if (stationCheck) check = t('home.check_sensors', { aqi: stationCheck.aqi });
    else if (modelCheck) check = t('home.model_check', { aqi: modelCheck.aqi });
    setText('reading-check', check);
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
  const noteKey = { waqi: 'home.map_note_sensors', [COMMUNITY]: 'home.map_note_community', 'open-meteo': 'home.map_note_model' }[reading.districtsSource];
  setText('map-note', noteKey ? t(noteKey) : '');
}

function renderCharts() {
  const nowMs = Date.now();
  const series = state.file?.history?.city?.length ? state.file.history.city : state.liveHistory ?? [];
  renderDayChart($('chart-day-body'), series, nowMs);
  const { hasModel } = renderWeekChart($('chart-week-body'), series, nowMs) ?? {};
  const notes = [];
  if (hasModel) notes.push(t('home.chart_model_note'));
  if (state.reading?.mode === 'iqair') notes.push(t('home.chart_iqair_note'));
  setText('chart-note', notes.join(' '));
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
  state.reading = chooseReading({ file: state.file, live: state.live, liveSensors: state.liveSensors, cached: state.cached, nowMs: Date.now() });
  applyStrings();
  renderLead();
  renderSubscribe();
  renderDistricts();
  renderCharts();
  renderAdvice();
  if (state.reading.city && !state.reading.notice) {
    const { city, districts, districtsSource, comparable } = state.reading;
    store(CACHE_KEY, JSON.stringify({ city, districts, districtsSource, comparable }));
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

  // Район и подпись каждого датчика известны из файла, поэтому без файла свежие показания не применить
  const knownPoints = state.file?.points ?? [];
  const sensorLoad = knownPoints.some((p) => p.source === COMMUNITY)
    ? fetchJson(boxUrl()).then((body) => { state.liveSensors = liveSensorsFromBody(body, knownPoints); }).catch(() => { state.liveSensors = null; })
    : Promise.resolve();
  await Promise.all([liveLoad, sensorLoad]);
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
