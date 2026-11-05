import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileKeywords, dedupe, itemId, matchKeywords, titleSimilarity, toItems, updateNews } from '../scripts/lib/news.mjs';

const compiled = compileKeywords(JSON.parse(readFileSync('config/keywords.json', 'utf8')));
const hits = (t) => matchKeywords(t, compiled).length > 0;

test('смог как явление находится', () => {
  for (const t of [
    'Бишкек накрыл смог',
    'Смог окутал столицу',
    'Смог и пыль над городом',
    'Смог мешает дышать бишкекчанам',
    'Как защититься от смога',
    'Борьба со смогом в Бишкеке',
    'Мэрия рассказала о смоге',
  ]) assert.ok(hits(t), t);
});

test('смог как глагол не проходит', () => {
  for (const t of [
    'Он смог победить в финале',
    'Депутат не смог объяснить расходы',
    'Спортсмен смог выйти в полуфинал',
    'Никто не смог ответить на вопрос',
    'Кыргызстанец смог бы улучшить результат',
  ]) assert.ok(!hits(t), t);
});

test('уголь находится во всех формах, но не уголовные дела и не углы', () => {
  for (const t of ['Цены на уголь выросли', 'Нехватка угля', 'Топят углем', 'Топят углём', 'Угольные брикеты подорожали']) assert.ok(hits(t), t);
  for (const t of ['Возбуждено уголовное дело', 'В углу комнаты', 'Угловой удар в матче', 'Уголовный кодекс изменят']) assert.ok(!hits(t), t);
});

test('остальные выражения списка', () => {
  for (const t of [
    'Качество воздуха в столице',
    'Качества воздуха ухудшилось',
    'Загрязнение реки Чу',
    'Отопление включат в октябре',
    'Об отоплении многоквартирных домов',
    'ТЭЦ Бишкека работает в штатном режиме',
    'Концентрация PM2.5 превысила норму',
    'Теплоснабжение восстановили',
    'Экология в Бишкеке вызывает тревогу',
    'Бишкекская мэрия обсудила экологию',
    'Электроотопление дорожает',
    'Тепловые насосы для школ',
    'Установка тепловых насосов в садах',
    'Солнечные панели на крышах',
    'Газификация новостроек',
    'Отключения электроэнергии 5 ноября',
    'Лимиты на электроэнергию вводятся',
  ]) assert.ok(hits(t), t);
});

test('посторонние новости не проходят', () => {
  for (const t of [
    'В Бишкеке проводят рейд на общественном транспорте',
    'Садыр Жапаров запретил энергетики',
    'Экология Иссык-Куля',
    'Панель управления обновят',
    'PM2 5 мая',
  ]) assert.ok(!hits(t), t);
});

test('повторы убираются: та же ссылка и почти тот же заголовок', () => {
  const a = { id: itemId('https://www.24.kg/a?utm_source=x'), title: 'В Бишкеке ввели лимиты на электроэнергию для домов', published: '2026-11-01T01:00:00Z' };
  const b = { id: itemId('https://24.kg/a/'), title: 'Другой заголовок совсем', published: '2026-11-01T02:00:00Z' };
  const c = { id: 'c', title: 'Для домов в Бишкеке ввели лимиты на электроэнергию', published: '2026-11-01T03:00:00Z' };
  const d = { id: 'd', title: 'ТЭЦ Бишкека перешла на зимний режим', published: '2026-11-01T04:00:00Z' };
  assert.equal(a.id, b.id);
  assert.ok(titleSimilarity(a.title, c.title) >= 0.6);
  assert.deepEqual(dedupe([a, b, c, d]).map((i) => i.id), ['d', a.id]);
});

test('дата из будущего заменяется текущей, подводка короткая', () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const items = toItems([{
    title: 'Смог над городом',
    link: 'https://kaktus.media/1',
    description: 'Над Бишкеком снова смог. Второе предложение не нужно.',
    published: 'Fri, 01 Jan 2027 00:00:00 +0600',
  }], { id: 'k', name: 'K' }, compiled, now);
  assert.equal(items[0].published, new Date(now).toISOString());
  assert.equal(items[0].excerpt, 'Над Бишкеком снова смог. Второе предложение не нужно.');
});

test('сбой одной ленты не мешает остальным и лента накапливается', async () => {
  const now = Date.parse('2026-11-05T00:00:00Z');
  const rss = '<rss><channel><item><title>Цены на уголь</title><link>https://a.kg/1</link><pubDate>Wed, 04 Nov 2026 10:00:00 +0600</pubDate></item></channel></rss>';
  const prev = { items: [{ id: 'old', title: 'Старая новость про ТЭЦ', source: 'x', link: 'https://a.kg/0', published: '2026-11-03T00:00:00Z', excerpt: '' }] };
  const out = await updateNews({
    prev,
    feeds: [{ id: 'ok', name: 'OK', url: 'ok' }, { id: 'down', name: 'Down', url: 'down' }, { id: 'html', name: 'Html', url: 'html' }],
    compiled,
    nowMs: now,
    fetcher: async (u) => {
      if (u === 'down') throw new Error('boom');
      return u === 'html' ? '<!doctype html><html></html>' : rss;
    },
  });
  assert.equal(out.items.length, 2);
  assert.match(out.status.ok, /^ok/);
  assert.match(out.status.down, /^ошибка/);
  assert.equal(out.status.html, 'ошибка: не RSS');
});
