import { fmtDayYear, fmtNumber, initPage, t } from './common.js';
import { ACH_MINIMUM, ACH_SMOG, priceRange, requiredCadr, roomForCadr, suitablePurifiers } from './calc.js';
import { CHECKED_ON, PURIFIERS } from '../config/purifiers.js';
import { LINKS, SHOPS } from '../config/shops.js';

const $ = (id) => document.getElementById(id);
const node = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
};
const nf = (n) => fmtNumber(n);
const range = (a, b) => (a === b ? nf(a) : `${nf(a)}–${nf(b)}`);
const STOCK_KEY = { in: 'pur.stock_in', order: 'pur.stock_order', out: 'pur.stock_out' };

const cadrText = (p) => {
  if (!p.cadr) return t('pur.no_data');
  return `${range(p.cadr.min, p.cadr.max)}${p.cadr.seller ? '*' : ''}`;
};

function renderTable() {
  const headers = ['pur.th_model', 'pur.th_price', 'pur.th_cadr', 'pur.th_room_calc', 'pur.th_room_claim', 'pur.th_filter', 'pur.th_interval', 'pur.th_noise'];
  const head = node('tr');
  headers.forEach((key, i) => head.append(node('th', { class: i === 0 ? 'sticky' : (i >= 1 && i <= 3) || i === 5 ? 'num' : '', scope: 'col' }, t(key))));
  const body = node('tbody');
  for (const p of PURIFIERS) {
    const price = priceRange(p.listings);
    const room = p.cadr ? roomForCadr(p.cadr.min) : null;
    const row = node('tr');
    const link = node('a', { href: `#${p.id}` }, p.name);
    row.append(
      node('th', { class: 'sticky', scope: 'row' }, link),
      node('td', { class: 'num' }, price ? range(price.min, price.max) : t('pur.no_data')),
      node('td', { class: 'num' }, cadrText(p)),
      node('td', { class: 'num' }, room ? `${nf(room)}${p.cadr.seller ? '*' : ''}` : t('pur.no_data')),
      node('td', {}, p.room),
      node('td', { class: 'num' }, p.filter.price ? `${nf(p.filter.price)}${p.filter.priceNote ? '†' : ''}` : t('pur.no_data')),
      node('td', {}, p.filter.interval ?? t('pur.no_data')),
      node('td', {}, p.noise),
    );
    body.append(row);
  }
  const table = node('table', { class: 'compare' }, node('thead', {}, head), body);
  $('compare').replaceChildren(table);
}

function shopLine(item, key) {
  const shop = SHOPS[item.shop];
  const a = node('a', { href: LINKS[item.link], rel: 'noopener nofollow', target: '_blank' }, shop.name);
  const parts = [`${nf(item.price)} ${t('pur.som')}`];
  if (key) parts.push(t(STOCK_KEY[key]));
  if (item.note) parts.push(item.note);
  return node('li', {}, a, `: ${parts.join(', ')}`);
}

function renderCards() {
  const list = $('cards');
  list.replaceChildren();
  for (const p of PURIFIERS) {
    const notes = node('ul', { class: 'pur__notes' }, ...p.notes.map((n) => node('li', {}, n)));
    const shops = node('ul', { class: 'pur__shops' }, ...p.listings.map((l) => shopLine(l, l.stock)));
    const card = node(
      'li',
      { class: 'pur', id: p.id },
      node('h3', {}, p.name + (p.code ? ` (${p.code})` : '')),
      node('p', { class: 'pur__label' }, t('pur.where')),
      shops,
    );
    if (p.filter.links.length) {
      card.append(
        node('p', { class: 'pur__label' }, `${t('pur.filter')} ${p.filter.model}`),
        node('ul', { class: 'pur__shops' }, ...p.filter.links.map((l) => shopLine(l))),
      );
    }
    card.append(node('p', { class: 'pur__label' }, t('pur.know')), notes);
    list.append(card);
  }
}

function renderCalc() {
  const area = Number($('room-area').value);
  const height = Number($('room-height').value);
  const out = $('room-result');
  const min = requiredCadr(area, height, ACH_MINIMUM);
  if (!min) {
    out.replaceChildren(node('p', {}, t('pur.calc_enter')));
    return;
  }
  const smog = requiredCadr(area, height, ACH_SMOG);
  const fits = suitablePurifiers(PURIFIERS, min).slice(0, 4);
  const content = [
    node('p', { class: 'meta' }, t('pur.calc_min')),
    node('p', { class: 'calc__big' }, `${nf(min)} ${t('pur.m3h')}`),
    node('p', {}, t('pur.calc_smog', { smog: nf(smog) })),
  ];
  if (fits.length) {
    content.push(node('p', { class: 'pur__label' }, t('pur.calc_fits')));
    content.push(node('ul', { class: 'pur__shops' }, ...fits.map((p) => {
      const a = node('a', { href: `#${p.id}` }, p.name);
      return node('li', {}, a, `: ${t('pur.calc_fit_line', { cadr: cadrText(p), price: nf(p.fromPrice) })}`);
    })));
    if (fits.some((p) => p.cadr.seller)) content.push(node('p', { class: 'note' }, t('pur.footnote_seller')));
  } else {
    content.push(node('p', { class: 'calc__warn' }, t('pur.calc_none')));
  }
  out.replaceChildren(...content);
}

function render() {
  renderTable();
  renderCards();
  renderCalc();
  $('checked-on').textContent = t('pur.checked', { date: fmtDayYear(Date.parse(CHECKED_ON)) });
}

initPage({ onLangChange: render });
$('room-area').addEventListener('input', renderCalc);
$('room-height').addEventListener('input', renderCalc);
render();
