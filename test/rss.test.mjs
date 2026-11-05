import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, firstSentence, parseFeed, stripHtml } from '../scripts/lib/rss.mjs';

test('разбирает CDATA, HTML внутри описания и сущности', () => {
  const items = parseFeed(`<?xml version="1.0"?><rss><channel><title>Лента</title>
    <item><title><![CDATA[Смог & пыль]]></title><link>https://a.kg/1</link>
    <description><![CDATA[<div class="x"><img src="a.jpg" alt="картинка" /></div><p>Текст &laquo;новости&raquo;</p>]]></description>
    <pubDate>Thu, 05 Nov 2026 10:19:18 +0600</pubDate></item>
    <item><title>Обычный &amp; заголовок</title><link>https://a.kg/2?x=1&amp;y=2</link>
    <description>&lt;p&gt;Экранированный &lt;b&gt;HTML&lt;/b&gt;&lt;/p&gt;</description></item>
    </channel></rss>`);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Смог & пыль');
  assert.equal(items[0].description, 'Текст «новости»');
  assert.equal(items[1].title, 'Обычный & заголовок');
  assert.equal(items[1].link, 'https://a.kg/2?x=1&y=2');
  assert.equal(items[1].description, 'Экранированный HTML');
});

test('незакрытый тег в обрезанном описании не ломает разбор', () => {
  const items = parseFeed('<rss><channel><item><title>T</title><link>https://a.kg/1</link><description><![CDATA[<p>Более высокое потребление]]></description></item></channel></rss>');
  assert.equal(items[0].description, 'Более высокое потребление');
});

test('Atom: ссылка в атрибуте', () => {
  const items = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://a.kg/x"/><summary>S</summary><updated>2026-11-05T00:00:00Z</updated></entry></feed>');
  assert.equal(items[0].link, 'https://a.kg/x');
  assert.equal(items[0].published, '2026-11-05T00:00:00Z');
});

test('ссылки не http и страницы не RSS отбрасываются', () => {
  assert.equal(parseFeed('<rss><channel><item><title>T</title><link>javascript:alert(1)</link></item></channel></rss>').length, 0);
  assert.throws(() => parseFeed('<!doctype html><html><head><title>Лента</title></head></html>'));
});

test('вредоносный HTML не переживает очистку', () => {
  assert.equal(stripHtml('<script>alert(1)</script>Текст<img src=x onerror=alert(1)>'), 'Текст');
  assert.equal(decodeEntities('&#1057;&#x43C;&amp;'), 'См&');
});

test('подводка: одно предложение, короткие обрывки дополняются', () => {
  assert.equal(firstSentence('Первое предложение достаточно длинное для подводки. Второе.'), 'Первое предложение достаточно длинное для подводки.');
  assert.equal(firstSentence('Коротко. Но второе предложение уже подходит для подводки.'), 'Коротко. Но второе предложение уже подходит для подводки.');
  assert.ok(firstSentence('слово '.repeat(100)).endsWith('…'));
  assert.equal(firstSentence(''), '');
});
