import winston from 'winston';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

// ─── Structured Logger ───────────────────────────────────────────────────────

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: false }),
    winston.format.json(),
    winston.format((info) => {
      // Scrub sensitive fields
      const scrubKeys = ['token', 'access_token', 'client_secret', 'authorization', 'password', 'secret'];
      const scrubbed = { ...info };
      for (const key of scrubKeys) {
        if (scrubbed[key]) scrubbed[key] = '[REDACTED]';
      }
      return scrubbed;
    })()
  ),
  transports: [
    // All logs go to stderr — stdout is reserved for the STDIO MCP transport
    new winston.transports.Stream({
      stream: process.stderr,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
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
