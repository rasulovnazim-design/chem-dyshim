import { dataUrl, fetchJson, fmtClock, fmtDay, fmtDayClock, initPage, t } from './common.js';
import { FEEDS } from '../config/sources.js';

const SUMMARY_MAX_AGE_MS = 48 * 3600e3;
const $ = (id) => document.getElementById(id);
let news = null;

const safeLink = (url) => (/^https?:\/\//i.test(url ?? '') ? url : null);

function renderSummary() {
  const box = $('summary');
  const s = news?.summary;
  const fresh = s?.text && Date.now() - Date.parse(s.generated_at) <= SUMMARY_MAX_AGE_MS;
  box.hidden = !fresh;
  if (!fresh) return;
  $('summary-text').textContent = s.text;
  $('summary-meta').textContent = t('news.summary_meta', { date: fmtDay(Date.parse(s.generated_at)), n: s.items_count });
}

function renderList() {
  const list = $('news-list');
  list.replaceChildren();
  const items = news?.items ?? [];
  let lastDay = null;
  for (const item of items) {
    const href = safeLink(item.link);
    if (!href) continue;
    const ms = Date.parse(item.published);
    const day = fmtDay(ms);
    if (day !== lastDay) {
      const heading = document.createElement('p');
      heading.className = 'news-day';
      heading.textContent = day;
      list.append(heading);
      lastDay = day;
    }
    const article = document.createElement('article');
    article.className = 'news-item';
    const h2 = document.createElement('h2');
    const a = document.createElement('a');
    a.href = href;
    a.rel = 'noopener nofollow';
    a.target = '_blank';
    a.textContent = item.title;
    h2.append(a);
    article.append(h2);
    if (item.excerpt) {
      const p = document.createElement('p');
      p.textContent = item.excerpt;
      article.append(p);
    }
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = item.source;
    const time = document.createElement('span');
    time.className = 'news-time';
    time.textContent = fmtClock(ms);
    article.append(badge, time);
    list.append(article);
  }
  $('news-empty').hidden = items.length > 0;
  if (!items.length) $('news-empty').textContent = t(news ? 'news.empty' : 'news.unavailable');
}

function renderStatus() {
  const meta = $('news-meta');
  if (!news) { meta.hidden = true; return; }
  const down = FEEDS.filter((f) => String(news.status?.[f.id] ?? '').startsWith('ошибка')).map((f) => f.name);
  const parts = [t('news.updated', { time: fmtDayClock(Date.parse(news.generated_at)) })];
  if (down.length) parts.push(t('news.sources_down', { list: down.join(', ') }));
  meta.textContent = parts.join(' ');
  meta.hidden = false;
}

function render() {
  renderSummary();
  renderList();
  renderStatus();
}

initPage({ onLangChange: render });
try {
  news = await fetchJson(dataUrl('data/news.json'));
} catch {
  news = null;
}
render();
