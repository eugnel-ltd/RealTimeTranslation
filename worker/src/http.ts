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

export class InvalidRequestError extends Error {}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Every known field has a validator; absent optional fields and unknown keys retain compatibility. */
export async function readJson<T>(
  request: Request,
  fields: { [K in keyof T]-?: (value: unknown) => boolean },
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvalidRequestError('Invalid JSON body');
  }
  if (!isJsonObject(body)) throw new InvalidRequestError('JSON body must be an object');
  for (const [key, validate] of Object.entries(fields) as Array<[string, (value: unknown) => boolean]>) {
    if (Object.hasOwn(body, key) && !validate(body[key])) throw new InvalidRequestError('Invalid request fields');
  }
  return body as T;
}

export function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

export function logError(fields: Record<string, unknown>): void {
  console.error(JSON.stringify(fields));
}
