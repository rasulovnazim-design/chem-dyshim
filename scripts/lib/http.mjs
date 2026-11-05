// Сетевые запросы. Ошибки специально не содержат адрес: в нём может быть токен,
// а текст ошибки попадает в публичный data/aqi.json.
import { USER_AGENT } from '../../config/sources.js';

export class SourceError extends Error {}

async function request(url, { timeoutMs = 25000, retries = 1, accept } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new SourceError(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err instanceof SourceError ? err : new SourceError(err?.name === 'TimeoutError' ? 'таймаут' : 'сетевая ошибка');
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastError;
}

export async function fetchJson(url, options) {
  const res = await request(url, options);
  try {
    return await res.json();
  } catch {
    throw new SourceError('ответ не является JSON');
  }
}

export async function fetchText(url, options) {
  const res = await request(url, options);
  return res.text();
}

export const errorText = (err) => (err instanceof SourceError ? err.message : 'внутренняя ошибка');
