import { AccountRequestError, accountFailure, validAccountId } from './accountErrors';
import { errorJson, isString, json, readJson } from './http';
import { PROFILE_IDS, PROFILE_SEEDS, MAX_PROFILE_BYTES, isProfileId, type CandidateProfile, type ProfileId, type ProfileLoader } from './profiles';

export const MAX_PROFILE_NAME_BYTES = 256;
type Row = Record<string, unknown>;

export function createAccountProfiles(db: D1Database, accountId: string) {
  if (!validAccountId(accountId) || typeof db?.prepare !== 'function' || typeof db.batch !== 'function') throw new AccountRequestError(503);
  // Both identifiers are captured values; later request/context mutation cannot redirect SQL.
  const owner = accountId;
  const database = db;

  async function query(sql: string, values: string[]): Promise<Row[]> {
    try {
      const result = await database.prepare(sql).bind(...values).all<Row>();
      if (result?.success !== true || !Array.isArray(result.results)
          || result.results.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) throw new AccountRequestError(503);
      return result.results;
    } catch (error) { return accountFailure(error); }
  }

  function checkFence(rows: Row[]) {
    if (rows.length === 0 || rows.some(row => row.fenced !== 0 && row.fenced !== 1)) throw new AccountRequestError(503);
    if (rows.some(row => row.fenced === 1)) throw new AccountRequestError(401, 'Account session is unavailable');
  }

  async function assertActive() {
    const rows = await query('SELECT EXISTS(SELECT 1 FROM account_profile_fences WHERE account_id=?1) AS fenced', [owner]);
    if (rows.length !== 1) throw new AccountRequestError(503);
    checkFence(rows);
  }

  function stored(row: Row): CandidateProfile | null {
    if (row.profile_id === null) return null;
    if (typeof row.profile_id !== 'string' || !isProfileId(row.profile_id) || typeof row.name !== 'string' || typeof row.markdown !== 'string'
        || new TextEncoder().encode(row.name).byteLength > MAX_PROFILE_NAME_BYTES
        || new TextEncoder().encode(row.markdown).byteLength > MAX_PROFILE_BYTES) throw new AccountRequestError(503);
    return { id: row.profile_id, name: row.name, markdown: row.markdown };
  }

  const guardedSelect = `
    SELECT EXISTS(SELECT 1 FROM account_profile_fences WHERE account_id=?1) AS fenced,
      p.profile_id, p.name, p.markdown
    FROM (SELECT 1) AS anchor LEFT JOIN account_profiles AS p ON p.account_id=?1
      AND NOT EXISTS(SELECT 1 FROM account_profile_fences WHERE account_id=?1)
  `;
  const loader: ProfileLoader = Object.freeze({
    async get(id: string): Promise<CandidateProfile | null> {
      if (!isProfileId(id)) return null;
      const rows = await query(`${guardedSelect} AND p.profile_id=?2`, [owner, id]);
      if (rows.length !== 1) throw new AccountRequestError(503);
      checkFence(rows);
      return stored(rows[0]) ?? { id, name: PROFILE_SEEDS.find(seed => seed.id === id)!.name, markdown: '' };
    },
  });

  async function list() {
    const rows = await query(guardedSelect, [owner]);
    if (rows.length > PROFILE_IDS.length) throw new AccountRequestError(503);
    checkFence(rows);
    const profiles = new Map(rows.map(row => stored(row)).filter((profile): profile is CandidateProfile => profile !== null).map(profile => [profile.id, profile]));
    return PROFILE_SEEDS.map(seed => ({ id: seed.id, name: profiles.get(seed.id)?.name ?? seed.name }));
  }

  async function put(id: ProfileId, name: string, markdown: string) {
    if (!isProfileId(id)) throw new AccountRequestError(400, 'Unknown profile id');
    if (new TextEncoder().encode(name).byteLength > MAX_PROFILE_NAME_BYTES || new TextEncoder().encode(markdown).byteLength > MAX_PROFILE_BYTES) {
      throw new AccountRequestError(400, 'Profile is too large');
    }
    try {
      const result = await database.prepare(`
        INSERT INTO account_profiles(account_id,profile_id,name,markdown,updated_at)
        SELECT ?1,?2,?3,?4,?5 WHERE NOT EXISTS(SELECT 1 FROM account_profile_fences WHERE account_id=?1)
        ON CONFLICT(account_id,profile_id) DO UPDATE SET
          name=excluded.name, markdown=excluded.markdown, updated_at=excluded.updated_at
        WHERE NOT EXISTS(SELECT 1 FROM account_profile_fences WHERE account_id=?1)
      `).bind(owner, id, name, markdown, new Date().toISOString()).run();
      if (result?.success !== true) throw new AccountRequestError(503);
      if (result.meta?.changes === 0) { await assertActive(); throw new AccountRequestError(503); }
      if (result.meta?.changes !== 1) throw new AccountRequestError(503);
      return { id, name, markdown, bytes: new TextEncoder().encode(markdown).byteLength };
    } catch (error) { return accountFailure(error); }
  }

  async function erase(jobId: string) {
    if (!validAccountId(jobId)) throw new AccountRequestError(400, 'Invalid erasure request');
    try {
      const results = await database.batch<Row>([
        database.prepare('INSERT INTO account_profile_fences(account_id,deletion_job,fenced_at) VALUES (?1,?2,?3) ON CONFLICT(account_id) DO NOTHING').bind(owner, jobId, new Date().toISOString()),
        database.prepare('DELETE FROM account_profiles WHERE account_id=?1').bind(owner),
        database.prepare('SELECT (SELECT deletion_job FROM account_profile_fences WHERE account_id=?1) AS deletion_job,(SELECT COUNT(*) FROM account_profiles WHERE account_id=?1) AS remaining').bind(owner),
      ]);
      if (!Array.isArray(results) || results.length !== 3 || results.some(result => result?.success !== true)
          || ![0, 1].includes(results[0].meta?.changes) || !Number.isInteger(results[1].meta?.changes)
          || results[1].meta.changes < 0 || results[1].meta.changes > PROFILE_IDS.length
          || !Array.isArray(results[2].results) || results[2].results.length !== 1
          || !validAccountId(results[2].results[0].deletion_job) || results[2].results[0].remaining !== 0) throw new AccountRequestError(503);
    } catch (error) { accountFailure(error); }
  }

  return Object.freeze({ loader, assertActive, list, put, erase });
}

export type AccountProfiles = ReturnType<typeof createAccountProfiles>;

export async function handleAccountListProfiles(profiles: AccountProfiles) {
  return json({ profiles: await profiles.list() }, 200, { 'Cache-Control': 'no-store' });
}

export async function handleAccountGetProfile(profiles: AccountProfiles, id: string) {
  if (!isProfileId(id)) return errorJson('Unknown profile id', 404);
  return json(await profiles.loader.get(id), 200, { 'Cache-Control': 'no-store' });
}

export async function handleAccountPutProfile(request: Request, profiles: AccountProfiles, id: string) {
  if (!isProfileId(id)) return errorJson('Unknown profile id', 404);
  const body = await readJson<{ name?: string; markdown?: string }>(request, { name: isString, markdown: isString });
  const name = body.name?.trim() || PROFILE_SEEDS.find(seed => seed.id === id)!.name;
  const markdown = body.markdown ?? '';
  if (new TextEncoder().encode(markdown).byteLength > MAX_PROFILE_BYTES) return errorJson(`Profile exceeds ${MAX_PROFILE_BYTES} bytes`, 413);
  if (new TextEncoder().encode(name).byteLength > MAX_PROFILE_NAME_BYTES) return errorJson(`Profile name exceeds ${MAX_PROFILE_NAME_BYTES} bytes`, 413);
  return json(await profiles.put(id, name, markdown), 200, { 'Cache-Control': 'no-store' });
}
