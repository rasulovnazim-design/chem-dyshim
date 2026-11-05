// Новости: фильтр по ключевым словам, удаление повторов, накопление ленты.
import { createHash } from 'node:crypto';
import { errorText, fetchText } from './http.mjs';
import { firstSentence, parseFeed } from './rss.mjs';

const KEEP_ITEMS = 200;
const KEEP_DAYS = 90;
const DUPLICATE_WINDOW_MS = 3 * 24 * 3600e3;
const DUPLICATE_SIMILARITY = 0.6;

const normalise = (s) => s.toLowerCase().replace(/ё/g, 'е');
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';

function wordPattern(word) {
  return word
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\p{L}\\p{N}-]*');
}

/** "теплов* насос*" превращается в поиск двух слов рядом: между ними допускается до двух других. */
function phrasePattern(phrase) {
  const words = normalise(phrase).trim().split(/\s+/).map(wordPattern);
  return new RegExp(`${WORD_START}${words.join('(?:[\\s,]+[\\p{L}\\p{N}-]+){0,2}[\\s,]+')}${WORD_END}`, 'u');
}

export function compileKeywords({ keywords, ignore_regex: ignore = [] }) {
  return {
    terms: keywords.map((term) => ({ term, all: term.split('+').map(phrasePattern) })),
    // Шаблоны пишутся строчными буквами: текст перед сравнением тоже приводится к ним
    ignore: ignore.map((r) => new RegExp(r.replace(/ё/g, 'е'), 'gu')),
  };
}

/** Какие выражения нашлись. Пустой список значит, что новость не проходит фильтр. */
export function matchKeywords(text, compiled) {
  let t = normalise(text);
  for (const re of compiled.ignore) t = t.replace(re, ' ');
  return compiled.terms.filter(({ all }) => all.every((re) => re.test(t))).map(({ term }) => term);
}

export function canonicalLink(link) {
  try {
    const u = new URL(link);
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return link.toLowerCase();
  }
}

export const itemId = (link) => createHash('sha1').update(canonicalLink(link)).digest('hex').slice(0, 16);

function titleWords(title) {
  return new Set(normalise(title).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
}

export function titleSimilarity(a, b) {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

/** Убирает повторы: одна ссылка или почти одинаковый заголовок в пределах трёх дней. Остаётся более ранняя публикация. */
export function dedupe(items) {
  const sorted = [...items].sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  const kept = [];
  for (const item of sorted) {
    const repeat = kept.some((k) => k.id === item.id || (
      Math.abs(Date.parse(k.published) - Date.parse(item.published)) <= DUPLICATE_WINDOW_MS
      && titleSimilarity(k.title, item.title) >= DUPLICATE_SIMILARITY
    ));
    if (!repeat) kept.push(item);
  }
  return kept.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
}

function publishedIso(raw, nowMs) {
  const ms = Date.parse(raw);
  // Без даты или с датой из будущего считаем, что новость вышла в момент обнаружения
  return new Date(Number.isNaN(ms) || ms > nowMs ? nowMs : ms).toISOString();
}

export function toItems(rawItems, feed, compiled, nowMs) {
  return rawItems
    .filter((raw) => matchKeywords(`${raw.title}. ${raw.description}`, compiled).length > 0)
    .map((raw) => ({
      id: itemId(raw.link),
      title: raw.title,
      source: feed.name,
      source_id: feed.id,
      link: raw.link,
      published: publishedIso(raw.published, nowMs),
      excerpt: firstSentence(raw.description),
    }));
}

/** Собирает новый news.json. Лента одного источника может упасть, остальные от этого не страдают. */
export async function updateNews({ prev, feeds, compiled, nowMs, fetcher = fetchText }) {
  const status = {};
  const fresh = [];
  await Promise.all(feeds.map(async (feed) => {
    try {
      const raw = parseFeed(await fetcher(feed.url));
      const matched = toItems(raw, feed, compiled, nowMs);
      fresh.push(...matched);
      status[feed.id] = `ok: всего ${raw.length}, подошло ${matched.length}`;
    } catch (err) {
      status[feed.id] = `ошибка: ${err.message === 'не RSS' ? 'не RSS' : errorText(err)}`;
    }
  }));
  const cutoff = nowMs - KEEP_DAYS * 24 * 3600e3;
  const items = dedupe([...(prev?.items ?? []), ...fresh])
    .filter((item) => Date.parse(item.published) >= cutoff)
    .slice(0, KEEP_ITEMS);
  return {
    schema: 1,
    generated_at: new Date(nowMs).toISOString(),
    status,
    summary: prev?.summary ?? null,
    items,
  };
}
