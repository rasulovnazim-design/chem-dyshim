import { dataUrl, fetchJson, initPage } from './common.js';
import { SITE } from '../config/site.js';

initPage();

if (SITE.makers) {
  const makers = document.getElementById('makers');
  makers.textContent = SITE.makers;
  makers.hidden = false;
}
if (SITE.telegramChannel) {
  document.getElementById('support-channel-link').href = `https://t.me/${encodeURIComponent(SITE.telegramChannel)}`;
  document.getElementById('support-channel').hidden = false;
}
if (/^https?:\/\//.test(SITE.supportUrl)) {
  document.getElementById('support-link-a').href = SITE.supportUrl;
  document.getElementById('support-link').hidden = false;
}

// WAQI требует указывать первоисточники станций
try {
  const air = await fetchJson(dataUrl('data/aqi.json'));
  const list = (air.attributions ?? []).filter((a) => /^https?:\/\//.test(a.url));
  if (list.length) {
    const box = document.getElementById('attributions');
    box.append('Первоисточники данных станций: ');
    list.forEach((a, i) => {
      if (i) box.append(', ');
      const link = document.createElement('a');
      link.href = a.url;
      link.rel = 'noopener nofollow';
      link.textContent = a.name;
      box.append(link);
    });
    box.append('.');
    box.hidden = false;
  }
} catch {
  // Без файла данных остаётся только общая подпись
}
