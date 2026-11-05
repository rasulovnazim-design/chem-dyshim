// Небольшой разбор RSS и Atom без зависимостей: нам нужны только заголовок, ссылка, дата, описание.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  mdash: '-', ndash: '-', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bdquo: '„', shy: '',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? m;
    const cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });
}

export function stripHtml(s) {
  return s
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrap(raw) {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

/** Текст тега без разметки: снимает CDATA, разворачивает сущности, убирает HTML внутри. */
function tagText(block, names) {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (m) return decodeEntities(stripHtml(unwrap(m[1]))).trim();
  }
  return '';
}

function linkOf(block) {
  const plain = tagText(block, ['link']);
  if (plain) return plain;
  const atom = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return atom ? decodeEntities(atom[1]).trim() : '';
}

export function parseFeed(xml) {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('не RSS');
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((block) => ({
    title: tagText(block, ['title']),
    link: linkOf(block),
    description: tagText(block, ['description', 'summary', 'content:encoded', 'content']),
    published: tagText(block, ['pubDate', 'published', 'updated', 'dc:date']),
  })).filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

/** Первое законченное предложение описания, для короткой подводки. */
export function firstSentence(text, maxLength = 240) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const parts = clean.split(/(?<=[.!?…])\s+(?=[«"“]?[А-ЯЁA-Z0-9])/u);
  let out = '';
  for (const part of parts) {
    out = out ? `${out} ${part}` : part;
    // Короткий обрывок вроде «г. Бишкек.» подводкой не считается
    if (out.length >= 40) break;
  }
  if (out.length <= maxLength) return out;
  const cut = out.slice(0, maxLength);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : maxLength).replace(/[,;:\s-]+$/, '')}…`;
}
