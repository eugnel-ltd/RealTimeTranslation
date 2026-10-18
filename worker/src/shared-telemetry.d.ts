declare module 'eugnel-platform/telemetry' {
  export function createCrashReporter(options?: {
    dsn?: string;
    release?: string;
    environment?: string;
    fetchImpl?: typeof fetch;
  }): {
    enabled: boolean;
    capture(error: { name: string; message: string }, options?: {
      level?: string;
      tags?: Record<string, string>;
    }): Promise<boolean>;
  };

  export function healthResponse(options: {
    product: string;
    version: string;
    checks?: Record<string, () => boolean | Promise<boolean>>;
    timeoutMs?: number;
  }): Promise<Response>;
}
