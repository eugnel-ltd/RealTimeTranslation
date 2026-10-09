export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extra,
    },
  });
}

export function errorJson(message: string, status: number, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify(fields));
}
