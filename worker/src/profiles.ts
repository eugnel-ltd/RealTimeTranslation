import type { WorkerEnv } from './env';
import { errorJson, json, readJson } from './http';

export const PROFILE_IDS = ['james', 'wing'] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const PROFILE_SEEDS: Array<{ id: ProfileId; name: string }> = [
  { id: 'james', name: 'James' },
  { id: 'wing', name: 'Wing' },
];

export const MAX_PROFILE_BYTES = 200 * 1024;

export type CandidateProfile = {
  id: ProfileId;
  name: string;
  markdown: string;
};

/** Swap `kvProfileLoader` for a retrieval memory (e.g. Hindsight) later. */
export interface ProfileLoader {
  get(id: string): Promise<CandidateProfile | null>;
}

type ProfileMeta = { name?: string };

export function isProfileId(id: string): id is ProfileId {
  return (PROFILE_IDS as readonly string[]).includes(id);
}

export function profileKey(id: ProfileId): string {
  return `profile:${id}`;
}

export function kvProfileLoader(kv: KVNamespace | undefined): ProfileLoader {
  return {
    async get(id: string) {
      if (!isProfileId(id) || !kv) return null;
      const { value, metadata } = await kv.getWithMetadata<ProfileMeta>(profileKey(id));
      const seed = PROFILE_SEEDS.find((s) => s.id === id)!;
      return {
        id,
        name: metadata?.name?.trim() || seed.name,
        markdown: value ?? '',
      };
    },
  };
}

export async function handleListProfiles(env: WorkerEnv): Promise<Response> {
  if (!env.PROFILES) return errorJson('PROFILES KV is not configured', 503);
  const listed = await env.PROFILES.list({ prefix: 'profile:' });
  const names = new Map<string, string>();
  for (const key of listed.keys) {
    const id = key.name.slice('profile:'.length);
    const name = (key.metadata as ProfileMeta | null)?.name?.trim();
    if (id && name) names.set(id, name);
  }
  return json({
    profiles: PROFILE_SEEDS.map((s) => ({ id: s.id, name: names.get(s.id) || s.name })),
  });
}

export async function handleGetProfile(env: WorkerEnv, rawId: string): Promise<Response> {
  if (!env.PROFILES) return errorJson('PROFILES KV is not configured', 503);
  if (!isProfileId(rawId)) return errorJson('Unknown profile id', 404);
  const profile = await kvProfileLoader(env.PROFILES).get(rawId);
  if (!profile) return errorJson('Unknown profile id', 404);
  return json(profile);
}

export async function handlePutProfile(request: Request, env: WorkerEnv, rawId: string): Promise<Response> {
  if (!env.PROFILES) return errorJson('PROFILES KV is not configured', 503);
  if (!isProfileId(rawId)) return errorJson('Unknown profile id', 404);
  const body = await readJson<{ markdown?: string; name?: string }>(request);
  const markdown = typeof body.markdown === 'string' ? body.markdown : '';
  const bytes = new TextEncoder().encode(markdown).length;
  if (bytes > MAX_PROFILE_BYTES) {
    return errorJson(`Profile exceeds ${MAX_PROFILE_BYTES} bytes`, 413);
  }
  const seed = PROFILE_SEEDS.find((s) => s.id === rawId)!;
  const name = (body.name ?? seed.name).trim() || seed.name;
  await env.PROFILES.put(profileKey(rawId), markdown, { metadata: { name } });
  return json({ id: rawId, name, markdown, bytes });
}
