import winston from 'winston';
import { Writable } from 'stream';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

// ─── Secret redaction ────────────────────────────────────────────────────────

// Key names whose VALUE is a credential and must never be logged. `secret` and
// `password` are matched as substrings so client_secret / clientSecret are covered;
// `*token` (endsWith) covers access_token / accessToken / refreshToken WITHOUT
// catching benign status keys like `tokenCached`. The bare set holds the rest.
const SENSITIVE_KEY_NAMES = new Set(['authorization', 'pat']);
function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_NAMES.has(k) || k.includes('secret') || k.includes('password') || k.endsWith('token');
}

// Recursively redact the value of any sensitive-looking key, at any nesting depth —
// the previous scrub only checked top-level keys, so a credential tucked inside a
// nested object (e.g. { config: { client_secret } }) leaked into the logs. Returns a
// scrubbed COPY (never mutates the input). Error/Buffer/Date are returned as-is so
// winston's own error formatting still works; cycles are guarded with a seen-set.
export function redactSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (Array.isArray(value)) return value.map(v => redactSecrets(v, seen)) as unknown as T;
  if (value && typeof value === 'object') {
    if (value instanceof Error || value instanceof Date || Buffer.isBuffer(value)) return value;
    if (seen.has(value)) return '[Circular]' as unknown as T;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : redactSecrets(v, seen);
    }
    return out as unknown as T;
  }
  return value;
}

// ─── UI Log Buffer & SSE Broadcast ───────────────────────────────────────────

interface LogEntry { timestamp?: string; level: string; message: string; [k: string]: unknown; }

const LOG_BUFFER_SIZE = 300;
const logBuffer: LogEntry[] = [];
const logSseClients = new Set<{ write: (s: string) => boolean | void }>();

function broadcastLog(entry: LogEntry): void {
  if (!logSseClients.size) return;
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of logSseClients) {
    try { client.write(data); } catch { logSseClients.delete(client); }
  }
}

class UILogStream extends Writable {
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    try {
      const raw = chunk.toString().trim();
      if (raw) {
        const entry: LogEntry = JSON.parse(raw);
        logBuffer.push(entry);
        if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
        broadcastLog(entry);
      }
    } catch { /* non-JSON line – skip */ }
    cb();
  }
}

export function addLogSseClient(client: { write: (s: string) => boolean | void }): void {
  logSseClients.add(client);
}
export function removeLogSseClient(client: { write: (s: string) => boolean | void }): void {
  logSseClients.delete(client);
}
export function getLogBuffer(): LogEntry[] { return [...logBuffer]; }

// ─── Structured Logger ───────────────────────────────────────────────────────

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: false }),
    // Redact BEFORE json() so the masked values are what actually gets serialized
    // (the prior order scrubbed after json() had already rendered the message).
    // Start from a shallow spread so winston's Symbol-keyed fields (level/message)
    // survive, then deep-redact each string-keyed value.
    winston.format((info) => {
      const seen = new WeakSet<object>();
      const out = { ...info };
      for (const [k, v] of Object.entries(out)) {
        (out as Record<string, unknown>)[k] = isSensitiveKey(k) ? '[REDACTED]' : redactSecrets(v, seen);
      }
      return out;
    })(),
    winston.format.json()
  ),
  transports: [
    // All logs go to stderr — stdout is reserved for the STDIO MCP transport
    new winston.transports.Stream({
      stream: process.stderr,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Mirror every log entry (JSON) into the in-memory buffer for the UI log viewer
    new winston.transports.Stream({
      stream: new UILogStream(),
      format: winston.format.json()
    })
  ]
});

// ─── Metrics Registry ────────────────────────────────────────────────────────

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const toolCallCounter = new Counter({
  name: 'mcp_tool_calls_total',
  help: 'Total number of MCP tool calls',
  labelNames: ['tool', 'status'],
  registers: [metricsRegistry]
});

export const toolCallDuration = new Histogram({
  name: 'mcp_tool_call_duration_seconds',
  help: 'Duration of MCP tool calls in seconds',
  labelNames: ['tool'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry]
});

export const authRefreshCounter = new Counter({
  name: 'mcp_auth_refresh_total',
  help: 'Total number of authentication token refreshes',
  registers: [metricsRegistry]
});

export const adobeApiErrorCounter = new Counter({
  name: 'mcp_adobe_api_errors_total',
  help: 'Total number of Adobe API errors',
  labelNames: ['endpoint', 'status_code'],
  registers: [metricsRegistry]
});

// ─── Request Context ─────────────────────────────────────────────────────────

export function createRequestLogger(requestId: string, toolName?: string) {
  return logger.child({ requestId, toolName });
}
