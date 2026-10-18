export interface UptimeCheck {
  healthy: boolean;
  status?: number;
  reason?: 'http' | 'health' | 'timeout' | 'unreachable' | 'configuration';
}

export interface UptimeResult {
  configured: boolean;
  healthy: boolean;
  exitCode: 0 | 1 | 2;
  reason?: 'missing_credentials';
  checks: Partial<Record<'homepage' | 'api', UptimeCheck>>;
}

export function checkUptime(options?: {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  expectVersion?: string;
}): Promise<UptimeResult>;
