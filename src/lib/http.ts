import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

export interface FetchJsonOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** Name used in logs, e.g. "shopify.graphql". */
  op: string;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** JSON fetch with timeout, retries (exponential backoff + jitter) and structured errors. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const { body, timeoutMs = 15_000, retries = 3, op, headers, ...rest } = opts;
  let attempt = 0;
  for (;;) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt <= retries) {
          await backoff(attempt, res.headers.get('retry-after'));
          continue;
        }
        throw new HttpError(`${op} failed with ${res.status}`, res.status, text.slice(0, 2000));
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt <= retries) {
        logger.warn({ op, attempt }, 'http retry after network error');
        await backoff(attempt, null);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function backoff(attempt: number, retryAfter: string | null) {
  const fromHeader = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(fromHeader) ? fromHeader : Math.min(10_000, 250 * 2 ** attempt);
  const jitter = Math.random() * 250;
  await new Promise((r) => setTimeout(r, base + jitter));
}
