// Отправляет то, что update.mjs положил в state.inflight и что уже закоммичено в репозиторий.
import { readFile, writeFile } from 'node:fs/promises';
import { sendMessage } from './lib/telegram.mjs';

const MAX_ATTEMPTS = 3;
const PAUSE_MS = 3100; // Telegram ограничивает частоту сообщений в канале

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const state = JSON.parse(await readFile('data/state.json', 'utf8'));
const queue = state.inflight ?? [];

if (!token || !chatId || !queue.length) {
  console.log(queue.length ? 'Telegram не настроен' : 'Отправлять нечего');
  process.exit(0);
}

const retry = [];
let sent = 0;
for (const [i, item] of queue.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
  const res = await sendMessage({ token, chatId, text: item.text, kind: item.kind });
  if (res.ok) {
    sent++;
    continue;
  }
  console.log(`::warning::Telegram (${item.kind}): ${res.error}`);
  const attempts = (item.attempts ?? 0) + 1;
  if (res.definite && attempts < MAX_ATTEMPTS) retry.push({ ...item, attempts });
}

state.inflight = [];
state.retry = retry;
await writeFile('data/state.json', `${JSON.stringify(state)}\n`);
console.log(`Telegram: отправлено ${sent} из ${queue.length}, на повтор ${retry.length}`);
