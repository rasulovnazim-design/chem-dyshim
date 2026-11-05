import { fmtNumber, initPage, t } from './common.js';
import { heatingEstimate, leadLinks, powerWarnings } from './calc.js';
import { SITE } from '../config/site.js';
import { BASE_KWH_PER_MONTH, CLIMATE, COAL, DEMAND, HEAT_PUMP, LIMITS, TARIFF } from '../config/tariffs.js';

const $ = (id) => document.getElementById(id);
const CONFIG = { tariff: TARIFF, coal: COAL, demand: DEMAND, pump: HEAT_PUMP, climate: CLIMATE, baseKwhPerMonth: BASE_KWH_PER_MONTH };

// Расчёт оценочный, поэтому показываем округлённые цифры
const som = (n) => fmtNumber(Math.round(n / 100) * 100);
const kwh = (n) => fmtNumber(Math.round(n / 100) * 100);
const kw = (n) => fmtNumber(n, 1);

const node = (tag, className, ...children) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children);
  return el;
};

function readInputs() {
  return {
    area: Number($('h-area').value),
    coalSpend: Number($('h-coal').value),
    insulation: $('h-insulation').value,
  };
}

function row(label, a, b, sub) {
  const tr = node('tr');
  const th = node('th', '', label);
  th.scope = 'row';
  if (sub) th.append(node('small', 'calc__sub', sub));
  tr.append(th, node('td', 'num', a), node('td', 'num', b));
  return tr;
}

function renderResult() {
  const out = $('h-result');
  const estimate = heatingEstimate(readInputs(), CONFIG);
  if (!estimate) {
    out.replaceChildren(node('p', '', t('heat.calc_enter')));
    return null;
  }
  const { direct, pump, power, heatNow, heatFull, tonnes } = estimate;
  const head = node('tr');
  head.append(node('th'), node('th', 'num', t('heat.col_now')), node('th', 'num', t('heat.col_full')));
  const body = node('tbody');
  body.append(
    row(t('heat.row_heat'), kwh(heatNow), kwh(heatFull)),
    row(t('heat.row_direct'), som(direct.now), som(direct.full)),
    row(
      t('heat.row_pump'),
      som(pump.now.mid),
      som(pump.full.mid),
      t('heat.pump_range', { nowLow: som(pump.now.low), nowHigh: som(pump.now.high), fullLow: som(pump.full.low), fullHigh: som(pump.full.high) }),
    ),
    row(t('heat.row_power_direct'), kw(power.now.direct), kw(power.full.direct)),
    row(t('heat.row_power_pump'), kw(power.now.pump), kw(power.full.pump)),
  );
  const thead = node('thead', '', head);
  const table = node('table', 'calc__table', thead, body);
  const content = [
    node('p', '', t('heat.line_coal', { tonnes: fmtNumber(tonnes, 1), spend: fmtNumber($('h-coal').value) })),
    node('div', 'table-scroll', table),
  ];
  for (const w of powerWarnings(estimate, LIMITS)) {
    content.push(node('p', 'calc__warn', t(w.key, { kw: kw(w.kw), single: LIMITS.singlePhaseKw, three: LIMITS.threePhaseKw, peak: LIMITS.peakSinglePhaseKw })));
  }
  if (heatNow > heatFull) content.push(node('p', 'calc__warn', t('heat.note_overburn')));
  out.replaceChildren(...content);
  return estimate;
}

function leadMessage(estimate) {
  const { area, coalSpend, insulation } = readInputs();
  const lines = [
    t('heat.lead_hello'),
    t('heat.lead_area', { area: area || '?' }),
    t('heat.lead_insulation', { value: t(`heat.ins_${insulation}`) }),
    t('heat.lead_coal', { spend: coalSpend || '?' }),
    t('heat.lead_interest', { value: $('l-interest').selectedOptions[0].textContent }),
  ];
  const place = $('l-place').value.trim();
  const name = $('l-name').value.trim();
  if (place) lines.push(t('heat.lead_place', { value: place }));
  if (name) lines.push(t('heat.lead_name', { value: name }));
  if (estimate) lines.push(t('heat.lead_site', { direct: som(estimate.direct.full), pump: som(estimate.pump.full.mid) }));
  return lines.join('\n');
}

function renderLead(estimate) {
  const links = leadLinks(SITE.contact, leadMessage(estimate));
  const telegram = $('l-telegram');
  const whatsapp = $('l-whatsapp');
  for (const [el, url] of [[telegram, links.telegram], [whatsapp, links.whatsapp]]) {
    el.hidden = !url;
    if (url) el.href = url; else el.removeAttribute('href');
  }
  $('l-closed').hidden = Boolean(links.telegram || links.whatsapp);
}

function render() {
  const estimate = renderResult();
  renderLead(estimate);
}

initPage({ onLangChange: render });
for (const id of ['h-area', 'h-coal', 'h-insulation', 'l-place', 'l-name', 'l-interest']) {
  $(id).addEventListener('input', render);
}
render();
