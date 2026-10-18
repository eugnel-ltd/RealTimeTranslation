export class AccountRequestError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 503, message = 'Account service is unavailable') {
    super(message);
  }
}

export function validAccountId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value.trim() === value && [...value].every(character => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    });
}

export function accountFailure(error: unknown): never {
  if (error instanceof AccountRequestError) throw error;
  throw new AccountRequestError(503);
}
