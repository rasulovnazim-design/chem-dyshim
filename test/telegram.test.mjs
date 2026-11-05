import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState, escapeHtml, morningPost, newsPost, planPosts, sendMessage } from '../scripts/lib/telegram.mjs';
import { generateSummary, shouldSummarise } from '../scripts/lib/summary.mjs';

const SITE = 'https://example.org/';
// 07:10 в Бишкеке 5 ноября
const MORNING = Date.parse('2026-11-05T01:10:00Z');
const NOON = Date.parse('2026-11-05T06:00:00Z');
const NIGHT = Date.parse('2026-11-04T20:00:00Z');

const air = (aqi, ts, extra = {}) => ({
  source: 'waqi',
  districts_comparable: true,
  city: { aqi, timestamp: new Date(ts).toISOString() },
  districts: {
    leninsky: { name: 'Ленинский', aqi: aqi - 30 },
    oktyabrsky: { name: 'Октябрьский', aqi: aqi - 10 },
    pervomaisky: { name: 'Первомайский', aqi },
    sverdlovsky: { name: 'Свердловский', aqi: aqi + 20 },
  },
  ...extra,
});
const item = (id, published, title = `Новость ${id}`) => ({ id, title, source: '24.kg', link: `https://24.kg/${id}`, published: new Date(published).toISOString(), excerpt: '' });
const seeded = (extra) => ({ ...emptyState(), seeded: true, alert: { level: 0, at: '' }, ...extra });

test('утренний пост уходит один раз за день и только в утреннем окне', () => {
  const a = planPosts({ air: air(120, MORNING), news: { items: [] }, state: seeded(), nowMs: MORNING, configured: true, siteUrl: SITE });
  const morning = a.inflight.filter((p) => p.kind === 'morning');
  assert.equal(morning.length, 1);
  assert.equal(a.morning_date, '2026-11-05');
  const b = planPosts({ air: air(120, MORNING + 1800e3), news: { items: [] }, state: { ...a, inflight: [] }, nowMs: MORNING + 1800e3, configured: true, siteUrl: SITE });
  assert.equal(b.inflight.filter((p) => p.kind === 'morning').length, 0);
  for (const when of [NOON, NIGHT]) {
    const c = planPosts({ air: air(120, when), news: { items: [] }, state: seeded(), nowMs: when, configured: true, siteUrl: SITE });
    assert.equal(c.inflight.filter((p) => p.kind === 'morning').length, 0);
  }
});

test('утренний пост на устаревших данных не уходит и ждёт следующего запуска', () => {
  const a = planPosts({ air: air(120, MORNING - 5 * 3600e3), news: { items: [] }, state: seeded(), nowMs: MORNING, configured: true, siteUrl: SITE });
  assert.equal(a.inflight.length, 0);
  assert.equal(a.morning_date, null);
});

test('утренний пост называет худший и лучший район по датчикам', () => {
  const text = morningPost(air(120, MORNING), SITE, MORNING);
  assert.match(text, /Хуже всего: Свердловский \(AQI 140\)/);
  assert.match(text, /Лучше всего: Ленинский \(AQI 90\)/);
  assert.match(text, /Детям: /);
  assert.match(text, /Спорт на улице: /);
});

test('по модели худший и лучший район не называются', () => {
  const text = morningPost(air(120, MORNING, { source: 'open-meteo', districts_comparable: false }), SITE, MORNING);
  assert.doesNotMatch(text, /Хуже всего/);
  assert.match(text, /оценка модели/);
});

test('тревога срабатывает только при ухудшении до «вредно» и выше', () => {
  const run = (aqi, level) => planPosts({ air: air(aqi, NOON), news: { items: [] }, state: seeded({ alert: { level, at: '' } }), nowMs: NOON, configured: true, siteUrl: SITE });
  assert.equal(run(120, 1).inflight.length, 0, 'до «вредно для чувствительных» тревоги нет');
  assert.equal(run(160, 2).inflight.filter((p) => p.kind === 'alert').length, 1);
  assert.equal(run(160, 3).inflight.length, 0, 'уже сообщали об этом уровне');
  assert.equal(run(210, 3).inflight.length, 1, 'стало ещё хуже');
});

test('тревога не дёргается у границы категории', () => {
  let state = seeded({ alert: { level: 2, at: '' } });
  const step = (aqi) => {
    state = planPosts({ air: air(aqi, NOON), news: { items: [] }, state, nowMs: NOON, configured: true, siteUrl: SITE });
    return state.inflight.filter((p) => p.kind === 'alert').length;
  };
  assert.equal(step(155), 1);
  assert.equal(step(148), 0);
  assert.equal(step(152), 0, 'вернулись, но воздух так и не стал заметно лучше');
  assert.equal(step(135), 0);
  assert.equal(step(155), 1, 'после настоящего улучшения новое ухудшение снова считается');
});

test('первый запуск не считает текущий плохой воздух ухудшением', () => {
  const a = planPosts({ air: air(250, NOON), news: { items: [] }, state: { ...emptyState(), seeded: true }, nowMs: NOON, configured: true, siteUrl: SITE });
  assert.equal(a.inflight.length, 0);
  assert.equal(a.alert.level, 4);
});

test('новость отправляется один раз', () => {
  const news = { items: [item('a', NOON - 3600e3)] };
  const a = planPosts({ air: null, news, state: seeded(), nowMs: NOON, configured: true, siteUrl: SITE });
  assert.equal(a.inflight.length, 1);
  const b = planPosts({ air: null, news, state: { ...a, inflight: [] }, nowMs: NOON + 3600e3, configured: true, siteUrl: SITE });
  assert.equal(b.inflight.length, 0);
});

test('самый первый запуск не заваливает канал архивом', () => {
  const news = { items: [item('a', NOON - 3600e3), item('b', NOON - 7200e3)] };
  const a = planPosts({ air: null, news, state: emptyState(), nowMs: NOON, configured: true, siteUrl: SITE });
  assert.equal(a.inflight.length, 0);
  assert.equal(a.seeded, true);
  const b = planPosts({ air: null, news: { items: [item('c', NOON), ...news.items] }, state: a, nowMs: NOON, configured: true, siteUrl: SITE });
  assert.deepEqual(b.inflight.map((p) => p.id), ['news:c']);
});

test('пока Telegram не настроен, ничего не копится и потом не прилетает разом', () => {
  const news = { items: [item('a', NOON - 3600e3)] };
  const off = planPosts({ air: air(250, MORNING), news, state: seeded(), nowMs: MORNING, configured: false, siteUrl: SITE });
  assert.equal(off.inflight.length, 0);
  assert.equal(off.morning_date, null);
  const on = planPosts({ air: null, news, state: off, nowMs: NOON, configured: true, siteUrl: SITE });
  assert.equal(on.inflight.length, 0);
});

test('не больше пяти новостей за запуск, остальные идут следующим, старые не отправляются', () => {
  const items = Array.from({ length: 7 }, (_, i) => item(`n${i}`, NOON - i * 60e3));
  const a = planPosts({ air: null, news: { items: [...items, item('old', NOON - 72 * 3600e3)] }, state: seeded(), nowMs: NOON, configured: true, siteUrl: SITE });
  assert.equal(a.inflight.length, 5);
  assert.ok(a.seen_news.includes('old'));
  const b = planPosts({ air: null, news: { items }, state: { ...a, inflight: [] }, nowMs: NOON + 1800e3, configured: true, siteUrl: SITE });
  assert.equal(b.inflight.length, 2);
  const sent = [...a.inflight, ...b.inflight].map((p) => p.id);
  assert.equal(new Set(sent).size, 7);
});

test('оборванная отправка не повторяется, а явный отказ Telegram повторяется', () => {
  // update.mjs очищает inflight перед планированием, план не возвращает прошлые сообщения
  const state = seeded({ inflight: [] , retry: [{ id: 'news:x', kind: 'news', text: 't', attempts: 1 }] });
  const a = planPosts({ air: null, news: { items: [] }, state, nowMs: NOON, configured: true, siteUrl: SITE });
  assert.deepEqual(a.inflight.map((p) => p.id), ['news:x']);
  assert.deepEqual(a.retry, []);
});

test('заголовки из лент экранируются', () => {
  const text = newsPost({ title: '<b>Смог</b> & дым', excerpt: '<script>', source: 'A&B', link: 'https://a.kg/?x=1&y=2' });
  assert.ok(!text.includes('<script>'));
  assert.ok(text.includes('&lt;b&gt;Смог&lt;/b&gt; &amp; дым'));
  assert.equal(escapeHtml('"'), '&quot;');
});

test('sendMessage: таймаут считается неоднозначным, отказ явным, успех успехом', async () => {
  const send = (fetchImpl) => sendMessage({ token: 'T', chatId: 'C', text: 'x', kind: 'news', fetchImpl });
  assert.deepEqual(await send(async () => ({ ok: true, json: async () => ({ ok: true }) })), { ok: true });
  const timeout = await send(async () => { throw new Error('timeout https://api.telegram.org/botT/'); });
  assert.equal(timeout.definite, false);
  assert.ok(!timeout.error.includes('T/'), 'токен не попадает в текст ошибки');
  const denied = await send(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'chat not found' }) }));
  assert.equal(denied.definite, true);
  assert.match(denied.error, /chat not found/);
});

test('сводка: без ключа шаг молча пропускается, раз в день, с 6 утра', async () => {
  const news = { items: [item('a', NOON - 3600e3), item('old', NOON - 48 * 3600e3)] };
  assert.deepEqual(shouldSummarise({ apiKey: '', state: {}, news, nowMs: NOON }), []);
  assert.equal(shouldSummarise({ apiKey: 'k', state: {}, news, nowMs: NOON }).length, 1);
  assert.deepEqual(shouldSummarise({ apiKey: 'k', state: { summary_date: '2026-11-05' }, news, nowMs: NOON }), []);
  assert.deepEqual(shouldSummarise({ apiKey: 'k', state: {}, news, nowMs: NIGHT }), []);
  assert.equal(typeof generateSummary, 'function');
});
