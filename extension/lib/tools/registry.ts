export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(args);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}

export const toolRegistry = new ToolRegistry();
