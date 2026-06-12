import { createExpressApp } from './app.js';
import { startStdioServer } from '../mcp/server.js';
import { logger } from '../telemetry/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // STDIO transport — must be started before the HTTP server so the event loop is
  // already listening on stdin before any async I/O can race with it.
  // stdout is reserved exclusively for the STDIO MCP protocol; all other output
  // (logs, banner) goes to stderr.
  await startStdioServer();

  // HTTP streaming transport
  const app = createExpressApp();

  const server = app.listen(PORT, () => {
    logger.info(`AJO Content MCP Server started`, {
      port: PORT,
      ui: `http://localhost:${PORT}`,
      mcp: `http://localhost:${PORT}/mcp`,
      health: `http://localhost:${PORT}/health`
    });

    process.stderr.write(`
╔══════════════════════════════════════════════════════════╗
║         AJO Content MCP Server — Ready                  ║
╠══════════════════════════════════════════════════════════╣
║  UI      →  http://localhost:${PORT}                       ║
║  MCP     →  http://localhost:${PORT}/mcp (HTTP streaming) ║
║  MCP     →  stdin / stdout        (STDIO)               ║
║  Health  →  http://localhost:${PORT}/health                ║
║  Metrics →  http://localhost:${PORT}/metrics               ║
╠══════════════════════════════════════════════════════════╣
║  Open the UI to upload credentials and configure the    ║
║  sandbox before connecting MCP clients.                 ║
╚══════════════════════════════════════════════════════════╝
\n`);
  });

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down gracefully`);

    server.close((err) => {
      if (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
      }
      logger.info('Server closed cleanly');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
