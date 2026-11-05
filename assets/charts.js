// Графики без библиотек. Значение всегда видно в строке над графиком и в таблице под ним,
// поэтому на телефоне не нужно целиться пальцем в тонкую линию.
import { fmtClock, fmtDay, fmtWeekday, t } from './common.js';
import { LEVELS, levelOf } from './levels.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 358;
const H = 170;
const LEFT = 28;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 22;
const STEPS = [100, 150, 200, 300, 500];
const TICKS = [0, 50, 100, 150, 200, 300, 500];

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function axis(svg, yMax, y) {
  for (const tick of TICKS) {
    if (tick > yMax) continue;
    el('line', { x1: LEFT, x2: W - RIGHT, y1: y(tick), y2: y(tick), class: tick === 0 ? 'baseline' : 'grid' }, svg);
    const label = el('text', { x: LEFT - 5, y: y(tick) + 4, 'text-anchor': 'end' }, svg);
    label.textContent = String(tick);
  }
}

const levelName = (aqi) => t(`level.${levelOf(aqi)?.key ?? 'unknown'}`);

function readoutFor(node, whenText, entry) {
  node.replaceChildren();
  const strong = document.createElement('b');
  strong.textContent = `AQI ${entry.aqi}`;
  node.append(strong, ` ${levelName(entry.aqi).toLowerCase()}, ${whenText}`);
}

function table(headers, rows) {
  const wrap = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = t('home.chart_table');
  wrap.append(summary);
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const tbl = document.createElement('table');
  const head = tbl.createTHead().insertRow();
  headers.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i > 0) th.className = 'num';
    head.append(th);
  });
  const body = tbl.createTBody();
  rows.forEach((row) => {
    const tr = body.insertRow();
    row.forEach((cell, i) => {
      const td = tr.insertCell();
      td.textContent = cell ?? '';
      if (i > 0) td.className = 'num';
    });
  });
  scroll.append(tbl);
  wrap.append(scroll);
  return wrap;
}

const toEntry = (e) => ({ t: e[0] * 1000, aqi: e[1], pm25: e[2] ?? null, pm10: e[3] ?? null, src: e[4] ?? null });

/** Последняя запись в каждом часе. */
function hourly(series) {
  const byHour = new Map();
  for (const e of series) byHour.set(Math.floor(e.t / 3600e3), e);
  return byHour;
}

function bind(svg, count, onPick) {
  let current = count - 1;
  const pick = (i) => {
    current = Math.max(0, Math.min(count - 1, i));
    onPick(current);
  };
  const fromEvent = (event) => {
    const rect = svg.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * W;
  };
  svg.addEventListener('pointerdown', (event) => onPick(null, fromEvent(event)));
  svg.addEventListener('pointermove', (event) => onPick(null, fromEvent(event)));
  svg.setAttribute('tabindex', '0');
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { pick(current - 1); event.preventDefault(); }
    if (event.key === 'ArrowRight') { pick(current + 1); event.preventDefault(); }
  });
  return { setCurrent: (i) => { current = i; } };
}

function scales(values) {
  const max = Math.max(0, ...values);
  const yMax = STEPS.find((s) => max <= s) ?? Math.ceil(max / 100) * 100;
  const y = (v) => TOP + (1 - Math.min(v, yMax) / yMax) * (H - TOP - BOTTOM);
  return { yMax, y };
}

/** Столбики за последние 24 часа: каждый цветом своего уровня. */
export function renderDayChart(root, rawSeries, nowMs) {
  root.replaceChildren();
  const endHour = Math.floor(nowMs / 3600e3);
  const series = rawSeries.map(toEntry).filter((e) => e.t > nowMs - 24 * 3600e3);
  const readout = Object.assign(document.createElement('p'), { className: 'chart__readout' });
  if (!series.length) {
    readout.textContent = t('home.chart_empty');
    root.append(readout);
    return;
  }
  const byHour = hourly(series);
  const slots = Array.from({ length: 24 }, (_, i) => ({ hour: endHour - 23 + i, entry: byHour.get(endHour - 23 + i) ?? null }));
  const { yMax, y } = scales(series.map((e) => e.aqi));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('home.chart_day') });
  axis(svg, yMax, y);
  const plotW = W - LEFT - RIGHT;
  const slotW = plotW / 24;
  const barW = Math.max(2, slotW - 2);
  const bars = [];
  slots.forEach((slot, i) => {
    const x = LEFT + i * slotW + 1;
    if (slot.entry) {
      const top = y(slot.entry.aqi);
      const bottom = y(0);
      const r = Math.min(3, (bottom - top) / 2, barW / 2);
      bars[i] = el('path', {
        d: `M${x} ${bottom}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + barW - r}Q${x + barW} ${top} ${x + barW} ${top + r}V${bottom}Z`,
        fill: levelOf(slot.entry.aqi)?.color ?? LEVELS[0].color,
      }, svg);
    }
    if ((slot.hour * 3600e3 + 6 * 3600e3) % (6 * 3600e3) === 0) {
      const label = el('text', { x: x + barW / 2, y: H - 6, 'text-anchor': 'middle' }, svg);
      label.textContent = fmtClock(slot.hour * 3600e3);
    }
  });
  const pick = (index, px) => {
    let i = index;
    if (i === null) {
      i = Math.max(0, Math.min(23, Math.floor((px - LEFT) / slotW)));
      for (let d = 0; d < 24 && !slots[i].entry; d++) {
        if (slots[i - d]?.entry) { i -= d; break; }
        if (slots[i + d]?.entry) { i += d; break; }
      }
    }
    const slot = slots[i];
    if (!slot?.entry) return;
    bars.forEach((b, j) => b?.setAttribute('opacity', j === i ? '1' : '0.55'));
    controls.setCurrent(i);
    readoutFor(readout, fmtClock(slot.hour * 3600e3), slot.entry);
  };
  const controls = bind(svg, 24, pick);
  const last = slots.map((s, i) => (s.entry ? i : -1)).filter((i) => i >= 0).at(-1);
  readoutFor(readout, fmtClock(slots[last].hour * 3600e3), slots[last].entry);
  const rows = slots.filter((s) => s.entry).reverse().map((s) => [
    fmtClock(s.hour * 3600e3), String(s.entry.aqi), s.entry.pm25 === null ? '' : String(Math.round(s.entry.pm25)),
  ]);
  root.append(readout, svg, table([t('home.table_time'), t('home.table_aqi'), t('home.table_pm25')], rows));
}

/** Линия за 7 дней: участок окрашен цветом уровня, разрывы больше трёх часов не соединяются. */
export function renderWeekChart(root, rawSeries, nowMs) {
  root.replaceChildren();
  const start = nowMs - 7 * 24 * 3600e3;
  const series = rawSeries.map(toEntry).filter((e) => e.t >= start);
  const readout = Object.assign(document.createElement('p'), { className: 'chart__readout' });
  if (series.length < 2) {
    readout.textContent = t('home.chart_empty');
    root.append(readout);
    return { hasModel: false };
  }
  const { yMax, y } = scales(series.map((e) => e.aqi));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('home.chart_week') });
  axis(svg, yMax, y);
  const x = (ms) => LEFT + ((ms - start) / (nowMs - start)) * (W - LEFT - RIGHT);

  const days = new Map();
  for (const e of series) {
    const key = fmtDay(e.t);
    if (!days.has(key)) days.set(key, { t: e.t, values: [] });
    days.get(key).values.push(e.aqi);
  }
  // Подписи дней по полуночи Бишкека
  const dayMs = 24 * 3600e3;
  const offset = 6 * 3600e3;
  let midnight = Math.ceil((start + offset) / dayMs) * dayMs - offset;
  for (; midnight < nowMs; midnight += dayMs) {
    el('line', { x1: x(midnight), x2: x(midnight), y1: H - BOTTOM, y2: H - BOTTOM + 4, class: 'baseline' }, svg);
    if (x(midnight) + 22 < W) {
      const label = el('text', { x: x(midnight) + (dayMs / (nowMs - start)) * (W - LEFT - RIGHT) / 2, y: H - 6, 'text-anchor': 'middle' }, svg);
      label.textContent = fmtWeekday(midnight + 12 * 3600e3);
    }
  }

  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (b.t - a.t > 3 * 3600e3) continue;
    el('line', {
      x1: x(a.t), y1: y(a.aqi), x2: x(b.t), y2: y(b.aqi), 'stroke-width': 2, 'stroke-linecap': 'round',
      stroke: levelOf(Math.max(a.aqi, b.aqi))?.color ?? LEVELS[0].color,
    }, svg);
  }
  const lastEntry = series.at(-1);
  el('circle', { cx: x(lastEntry.t), cy: y(lastEntry.aqi), r: 4, fill: levelOf(lastEntry.aqi)?.color ?? LEVELS[0].color, stroke: '#fff', 'stroke-width': 2 }, svg);
  const cross = el('line', { y1: TOP, y2: H - BOTTOM, class: 'cross', visibility: 'hidden' }, svg);
  const marker = el('circle', { r: 4, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }, svg);

  const describe = (e) => `${fmtDay(e.t)}, ${fmtClock(e.t)}`;
  const pick = (index, px) => {
    let i = index;
    if (i === null) {
      const ms = start + ((px - LEFT) / (W - LEFT - RIGHT)) * (nowMs - start);
      i = series.reduce((best, e, j) => (Math.abs(e.t - ms) < Math.abs(series[best].t - ms) ? j : best), 0);
    }
    const e = series[i];
    for (const [node, attrs] of [
      [cross, { x1: x(e.t), x2: x(e.t), visibility: 'visible' }],
      [marker, { cx: x(e.t), cy: y(e.aqi), fill: levelOf(e.aqi)?.color ?? LEVELS[0].color, visibility: 'visible' }],
    ]) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    controls.setCurrent(i);
    readoutFor(readout, describe(e), e);
  };
  const controls = bind(svg, series.length, pick);
  readoutFor(readout, describe(lastEntry), lastEntry);

  const rows = [...days.entries()].reverse().map(([label, d]) => [
    label,
    String(Math.round(d.values.reduce((a, b) => a + b, 0) / d.values.length)),
    String(Math.max(...d.values)),
  ]);
  root.append(readout, svg, table([t('home.table_day'), t('home.table_mean'), t('home.table_max')], rows));
  return { hasModel: series.some((e) => e.src === 'm') };
}
