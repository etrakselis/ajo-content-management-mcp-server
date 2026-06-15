import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { toolCallCounter, toolCallDuration, createRequestLogger } from '../telemetry/index.js';

export function notConfiguredError() {
  const port = process.env.PORT || '3000';
  return {
    success: false,
    error: {
      code: 'NOT_CONFIGURED',
      message: `MCP server is not configured. Open http://localhost:${port} in your browser, upload your credentials JSON file, and enter your sandbox name to get started.`,
      details: {}
    }
  };
}

export function validationError(err: z.ZodError) {
  return {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input parameters',
      details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    }
  };
}

// ─── Output schemas (MCP structuredContent contract) ────────────────────────
// Every tool resolves to a common envelope: { success: boolean } plus either
// success fields or an `error` object. Declaring an outputSchema lets the host
// validate results and lets the model rely on a typed contract instead of
// inferring shape from the description prose. The central CallTool handler
// returns the same object as `structuredContent`, so these schemas describe it.

const ERROR_OUTPUT_SCHEMA = {
  type: 'object' as const,
  description: 'Present when success is false. See the ajo://error-codes resource for cause and recovery per code.',
  properties: {
    code: { type: 'string', description: 'Machine-readable error code (e.g. VALIDATION_ERROR, NOT_FOUND, CONFLICT, READ_ONLY_MODE)' },
    message: { type: 'string', description: 'Human-readable error description' },
    details: { description: 'Optional structured detail; for VALIDATION_ERROR this is an array of { path, message }' }
  },
  required: ['code', 'message']
};

/**
 * Build a tool outputSchema for the standard `{ success, ...fields, error }`
 * envelope. `successProps` describes the fields present on success; `error` is
 * always optional and `success` always required, so the schema is satisfied by
 * both the success and error branches.
 */
export function buildOutputSchema(successProps: Record<string, unknown> = {}) {
  return {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'true if the operation succeeded; false if `error` is populated' },
      ...successProps,
      error: ERROR_OUTPUT_SCHEMA
    },
    required: ['success']
  };
}

// Reusable success-field fragments.
export const DATA_OBJECT = { type: 'object' as const, description: 'Operation result payload (passthrough of the AJO API response).' };
export const ETAG_FIELD = { type: 'string' as const, description: 'Current ETag — pass to a subsequent update/patch for optimistic locking.' };
export const LIST_DATA = {
  type: 'object' as const,
  description: 'Paginated list result.',
  properties: {
    _page: {
      type: 'object',
      // count/next come straight from the API; tolerate null (some endpoints
      // express "no next page" as next: null rather than by omission).
      properties: { count: { type: ['number', 'null'] }, next: { type: ['string', 'null'], description: 'Cursor for the next page; pass as `start`. Null or absent on the last page.' } }
    },
    items: { type: 'array', items: { type: 'object' } }
  }
};

export async function withTelemetry<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  const requestId = uuidv4();
  const log = createRequestLogger(requestId, toolName);
  const end = toolCallDuration.startTimer({ tool: toolName });
  log.info(`Tool called: ${toolName}`);
  try {
    const result = await fn();
    toolCallCounter.inc({ tool: toolName, status: 'success' });
    log.info(`Tool succeeded: ${toolName}`);
    return result;
  } catch (err) {
    toolCallCounter.inc({ tool: toolName, status: 'error' });
    log.error(`Tool failed: ${toolName}`, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    end();
  }
}
