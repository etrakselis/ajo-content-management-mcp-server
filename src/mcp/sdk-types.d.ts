// Type stubs for @modelcontextprotocol/sdk
// These allow the project to compile; replace with the real package in production.

export declare class Server {
  constructor(info: { name: string; version: string }, options: { capabilities: Record<string, unknown> });
  setRequestHandler(schema: unknown, handler: (req: unknown) => Promise<unknown>): void;
  connect(transport: unknown): Promise<void>;
}

export declare class StdioServerTransport {
  constructor();
}

export declare class StreamableHTTPServerTransport {
  constructor(options: { sessionIdGenerator: () => string });
  sessionId?: string;
  onclose?: () => void;
  handleRequest(req: unknown, res: unknown): Promise<void>;
}

export declare const ListToolsRequestSchema: unique symbol;
export declare const CallToolRequestSchema: unique symbol;
export declare const ListResourcesRequestSchema: unique symbol;
export declare const ReadResourceRequestSchema: unique symbol;
