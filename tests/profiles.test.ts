import { describe, expect, it } from 'vitest';
import worker from '../worker/src/index';
import { handleGetProfile, handleListProfiles, handlePutProfile, MAX_PROFILE_BYTES } from '../worker/src/profiles';
import { mockEnv, mockKv } from './helpers';

function put(id: string, body: unknown): Request {
  return new Request(`https://rtt.eugnel.com/api/profiles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('profiles', () => {
  it('lists seed ids even when KV is empty', async () => {
    const res = await handleListProfiles(mockEnv());
    expect(await res.json()).toEqual({
      profiles: [
        { id: 'james', name: 'James' },
        { id: 'wing', name: 'Wing' },
      ],
    });
  });

  it('gets an empty seeded profile and round-trips markdown via PUT', async () => {
    const kv = mockKv();
    const env = mockEnv({ PROFILES: kv });
    const empty = await handleGetProfile(env, 'james');
    expect(await empty.json()).toEqual({ id: 'james', name: 'James', markdown: '' });

    const saved = await handlePutProfile(put('james', { name: 'James', markdown: '# Notes\n\nTypeScript.' }), env, 'james');
    expect(saved.ok).toBe(true);
    const got = (await (await handleGetProfile(env, 'james')).json()) as { markdown: string; name: string };
    expect(got.markdown).toBe('# Notes\n\nTypeScript.');
    expect(got.name).toBe('James');
  });

  it('rejects unknown ids and oversized bodies', async () => {
    const env = mockEnv();
    expect((await handleGetProfile(env, 'other')).status).toBe(404);
    expect((await handlePutProfile(put('other', { markdown: 'x' }), env, 'other')).status).toBe(404);
    const huge = 'x'.repeat(MAX_PROFILE_BYTES + 1);
    const res = await handlePutProfile(put('wing', { markdown: huge }), env, 'wing');
    expect(res.status).toBe(413);
  });

  it('lists the display name stored in KV metadata', async () => {
    const kv = mockKv();
    const env = mockEnv({ PROFILES: kv });
    await handlePutProfile(put('wing', { name: 'Wing Chan', markdown: '# Wing' }), env, 'wing');
    const listed = (await (await handleListProfiles(env)).json()) as {
      profiles: Array<{ id: string; name: string }>;
    };
    expect(listed.profiles).toEqual([
      { id: 'james', name: 'James' },
      { id: 'wing', name: 'Wing Chan' },
    ]);
  });

  it('returns 503 when KV is unbound', async () => {
    const res = await handleListProfiles(mockEnv({ PROFILES: undefined }));
    expect(res.status).toBe(503);
  });

  it('routes GET/PUT /api/profiles through the Worker fetch handler', async () => {
    const env = mockEnv();
    const list = await worker.fetch(new Request('https://rtt.eugnel.com/api/profiles'), env);
    expect(list.status).toBe(200);
    const saved = await worker.fetch(put('james', { markdown: '# Notes' }), env);
    expect(saved.ok).toBe(true);
    const got = (await (await worker.fetch(new Request('https://rtt.eugnel.com/api/profiles/james'), env)).json()) as {
      markdown: string;
    };
    expect(got.markdown).toBe('# Notes');
  });

  it('requires Access on /api/profiles', async () => {
    const env = mockEnv({ SKIP_ACCESS_CHECK: 'false', ACCESS_AUD: 'aud' });
    const res = await worker.fetch(new Request('https://rtt.eugnel.com/api/profiles'), env);
    expect(res.status).toBe(403);
  });
});
