// Рассылка в Telegram. Главное правило: одно и то же не отправляется дважды.
//
// Порядок такой: update.mjs решает, что отправить, и кладёт сообщения в state.inflight;
// этот список сразу коммитится в репозиторий, и только потом notify.mjs их отправляет.
// Если отправка оборвалась на середине, следующий запуск выбрасывает inflight, а не шлёт заново.
// Лучше один раз пропустить сообщение, чем повторить его.
import { ALERT_LEVEL_INDEX, LEVELS, levelIndex } from '../../assets/levels.js';
import { strings } from '../../assets/i18n.js';
import { bishkekClock, bishkekDate, bishkekDateLong, bishkekHour } from './time.mjs';

const ru = strings.ru;
const MORNING_FROM = 7;
const MORNING_UNTIL = 10; // cron в GitHub может опаздывать, поэтому окно, а не точная минута
const MAX_READING_AGE_MS = 3 * 3600e3;
const NEWS_PER_RUN = 5;
const NEWS_MAX_AGE_MS = 48 * 3600e3;
const SEEN_LIMIT = 2000;
const RECOVERY_MARGIN = 10; // на сколько AQI надо опуститься ниже уровня, чтобы тревога могла сработать снова

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const levelName = (i) => ru[`level.${LEVELS[i].key}`];
const adviceLine = (group, i) => `${ru[`advice.${group}`]}: ${ru[`advice.${group}.${LEVELS[i].key}`]}`;

export function sourceMark(air) {
  if (air.source === 'open-meteo') return ` (${ru['tg.model_mark']})`;
  if (air.source === 'sensor-community') return ` (${ru['tg.community_mark']})`;
  return '';
}

// IQAir просит указывать его как источник
const sourceLine = (air) => (air.source === 'iqair' ? [escapeHtml(ru['tg.source_iqair'])] : []);

export function districtsLine(air) {
  if (!air.districts_comparable) return ru['tg.model_districts'];
  const list = Object.values(air.districts).filter((d) => typeof d.aqi === 'number').sort((a, b) => b.aqi - a.aqi);
  const worst = list[0];
  const best = list[list.length - 1];
  if (worst.aqi - best.aqi < 10) return ru['tg.districts_even'];
  const template = air.districts_source === 'sensor-community' ? 'tg.districts_raw' : 'tg.districts';
  return fill(ru[template], { worst: worst.name, worstAqi: worst.aqi, best: best.name, bestAqi: best.aqi });
}

export function morningPost(air, siteUrl, nowMs) {
  const i = levelIndex(air.city.aqi);
  return [
    `${LEVELS[i].dot} <b>${escapeHtml(fill(ru['tg.morning_title'], { date: bishkekDateLong(nowMs) }))}</b>`,
    `AQI ${air.city.aqi}: ${escapeHtml(levelName(i).toLowerCase())}${escapeHtml(sourceMark(air))}`,
    ...sourceLine(air),
    '',
    escapeHtml(districtsLine(air)),
    '',
    escapeHtml(adviceLine('children', i)),
    escapeHtml(adviceLine('sport', i)),
    '',
    escapeHtml(siteUrl),
  ].join('\n');
}

export function alertPost(air, previousLevel, siteUrl) {
  const i = levelIndex(air.city.aqi);
  const clock = bishkekClock(Date.parse(air.city.timestamp));
  return [
    `${LEVELS[i].dot} <b>${escapeHtml(fill(ru['tg.alert_title'], { level: levelName(i).toLowerCase() }))}</b>`,
    escapeHtml(fill(ru['tg.alert_body'], { aqi: air.city.aqi, time: clock, before: levelName(Math.max(previousLevel, 0)).toLowerCase() }))
      + escapeHtml(sourceMark(air)),
    ...sourceLine(air),
    '',
    escapeHtml(adviceLine('children', i)),
    escapeHtml(adviceLine('windows', i)),
    '',
    escapeHtml(siteUrl),
  ].join('\n');
}

export function newsPost(item) {
  return [
    `<b>${escapeHtml(item.title)}</b>`,
    item.excerpt ? escapeHtml(item.excerpt) : null,
    '',
    `${escapeHtml(item.source)}: ${escapeHtml(item.link)}`,
  ].filter((line) => line !== null).join('\n');
}

export function emptyState() {
  return { schema: 1, seeded: false, seen_news: [], morning_date: null, alert: null, news_run_at: null, summary_date: null, inflight: [], retry: [] };
}

function isFresh(air, nowMs) {
  return Boolean(air?.city?.timestamp) && nowMs - Date.parse(air.city.timestamp) <= MAX_READING_AGE_MS;
}

/** Решает, что отправить в этот запуск. Возвращает новое состояние; inflight заполнен заново. */
export function planPosts({ air, news, state: prevState, nowMs, configured, siteUrl }) {
  const state = { ...emptyState(), ...prevState };
  const queue = configured ? [...(state.retry ?? [])] : [];
  state.retry = [];

  // Тревога: срабатывает только при ухудшении, с запасом на обратный путь, чтобы не дёргаться у границы
  if (isFresh(air, nowMs)) {
    const current = levelIndex(air.city.aqi);
    if (state.alert === null) {
      state.alert = { level: current, at: air.city.timestamp };
    } else if (current > state.alert.level) {
      if (configured && current >= ALERT_LEVEL_INDEX) {
        queue.push({ id: `alert:${air.city.timestamp}:${current}`, kind: 'alert', text: alertPost(air, state.alert.level, siteUrl) });
      }
      state.alert = { level: current, at: air.city.timestamp };
    } else if (current < state.alert.level && air.city.aqi <= LEVELS[state.alert.level - 1].max - RECOVERY_MARGIN) {
      state.alert = { level: current, at: air.city.timestamp };
    }

    // Утренний пост
    const today = bishkekDate(nowMs);
    const hour = bishkekHour(nowMs);
    if (configured && state.morning_date !== today && hour >= MORNING_FROM && hour < MORNING_UNTIL) {
      queue.push({ id: `morning:${today}`, kind: 'morning', text: morningPost(air, siteUrl, nowMs) });
      state.morning_date = today;
    }
  }

  // Новости: самый первый запуск только запоминает то, что уже есть, чтобы не засыпать канал архивом.
  // Пока Telegram не настроен, новости тоже просто отмечаются как виденные.
  const seen = new Set(state.seen_news);
  const unseen = (news?.items ?? []).filter((item) => !seen.has(item.id));
  let posted = 0;
  for (const item of [...unseen].reverse()) {
    const tooOld = nowMs - Date.parse(item.published) > NEWS_MAX_AGE_MS;
    if (!state.seeded || !configured || tooOld) { seen.add(item.id); continue; }
    if (posted >= NEWS_PER_RUN) continue; // остаток уйдёт следующим запуском
    queue.push({ id: `news:${item.id}`, kind: 'news', text: newsPost(item) });
    seen.add(item.id);
    posted++;
  }
  if (news) state.seeded = true;
  state.seen_news = [...seen].slice(-SEEN_LIMIT);
  state.inflight = queue;
  return state;
}

/**
 * Отправка одного сообщения. definite: true значит, что Telegram точно его не принял и можно повторить.
 * Таймаут неоднозначен (сообщение могло дойти), поэтому такой случай считается отправленным.
 */
export async function sendMessage({ token, chatId, text, kind, fetchImpl = fetch }) {
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: kind !== 'news' },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return { ok: false, definite: false, error: 'нет ответа от Telegram' };
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.ok) return { ok: true };
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(json.parameters?.retry_after ?? 5, 60);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return { ok: false, definite: true, error: `HTTP ${res.status}: ${json.description ?? 'нет описания'}` };
  }
  return { ok: false, definite: true, error: 'лимит Telegram' };
}
