// Запускается GitHub Actions каждые 30 минут: воздух при каждом запуске, новости раз в час.
// Падение любого источника не роняет запуск: каждый шаг изолирован.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { FEEDS } from '../config/sources.js';
import { SITE } from '../config/site.js';
import { updateAir } from './lib/air.mjs';
import { compileKeywords, updateNews } from './lib/news.mjs';
import { generateSummary, shouldSummarise } from './lib/summary.mjs';
import { emptyState, planPosts } from './lib/telegram.mjs';
import { bishkekDate } from './lib/time.mjs';

const NEWS_INTERVAL_MS = 55 * 60e3;

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value)}\n`);
  await rename(`${path}.tmp`, path);
}

async function step(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.log(`::warning::Шаг «${name}» не выполнен: ${err?.message ?? err}`);
    return undefined;
  }
}

const nowMs = Date.now();
const state = { ...emptyState(), ...(await readJson('data/state.json')) };
if (state.inflight?.length) {
  console.log(`Прошлый запуск не подтвердил отправку ${state.inflight.length} сообщ.: повторно они не отправляются.`);
}
state.inflight = [];

const { districts } = await readJson('config/districts.json');
const { places } = await readJson('config/neighbourhoods.json');

// Воздух
const prevAir = await readJson('data/aqi.json');
const air = await step('воздух', () => updateAir({ prev: prevAir, token: process.env.WAQI_TOKEN, iqairKey: process.env.IQAIR_API_KEY, districts, places, nowMs }));
if (air) {
  await writeJson('data/aqi.json', air);
  if (air.city) await writeJson('data/now.json', { aqi: air.city.aqi, category: air.city.category, timestamp: air.city.timestamp, source: air.city.source });
  console.log(`Воздух: ${air.city ? `AQI ${air.city.aqi}, источник ${air.source}, точек ${air.points.length}` : 'нет данных'}`);
  console.log(`  статус: ${JSON.stringify(air.status)}`);
}

// Новости: не чаще раза в час, чем бы ни был запущен шаг
const prevNews = await readJson('data/news.json');
const newsDue = !prevNews
  || !state.news_run_at
  || nowMs - Date.parse(state.news_run_at) >= NEWS_INTERVAL_MS;
let news = prevNews;
if (newsDue) {
  const keywords = await readJson('config/keywords.json');
  const fresh = await step('новости', () => updateNews({ prev: prevNews, feeds: FEEDS, compiled: compileKeywords(keywords), nowMs }));
  if (fresh) {
    news = fresh;
    state.news_run_at = new Date(nowMs).toISOString();
    console.log(`Новости: в ленте ${news.items.length}`);
    console.log(`  статус: ${JSON.stringify(news.status)}`);
  }
}

// Сводка: только если задан ANTHROPIC_API_KEY, иначе шаг молча пропускается
const apiKey = process.env.ANTHROPIC_API_KEY;
const toSummarise = shouldSummarise({ apiKey, state, news, nowMs });
if (toSummarise.length) {
  const summary = await step('сводка', () => generateSummary({ items: toSummarise, nowMs, apiKey }));
  if (summary) {
    news.summary = summary;
    state.summary_date = bishkekDate(nowMs);
    console.log('Сводка новостей обновлена');
  }
}
if (news) await writeJson('data/news.json', news);

// Что отправить в Telegram: сам запуск отправки идёт отдельным шагом, после коммита
const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const planned = await step('план рассылки', () => planPosts({
  air: air ?? prevAir, news, state, nowMs, configured, siteUrl: SITE.url,
}));
await writeJson('data/state.json', planned ?? state);
console.log(`Telegram: ${configured ? `к отправке ${(planned ?? state).inflight.length}` : 'не настроен, ничего не отправляется'}`);
