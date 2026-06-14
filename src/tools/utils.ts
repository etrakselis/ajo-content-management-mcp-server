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
