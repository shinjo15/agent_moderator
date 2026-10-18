import { expect, it, vi } from 'vitest';
import { createModeration } from '../src/jev/moderation';
import { createJevClient } from '../src/jev/client';
import { questions } from './fixtures/jev-client';
import { apiResponse, chatPost } from './fixtures/jev';

it.each(['stop', 'consent', 'key', 'ttl', 'cooldown'] as const)('遅い定義読込中の%s後はJev送信0・本文を古いsnapshotから復元しない', async scenario => {
  let time = 0; let confirmed = true; let key: string | undefined = 'synthetic';
  let cooldown = 0;
  let release!: () => void;
  const load = vi.fn(() => new Promise<typeof questions>(resolve => { release = () => resolve(structuredClone(questions)); }));
  const fetcher = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
  const session = { get: async () => ({ 'jev.notBefore': cooldown }), set: async () => {} };
  const moderation = createModeration({ client: createJevClient(fetcher, load), readKey: async () => key,
    readConfirmation: async () => confirmed, now: () => time, session });
  await moderation.enable(); moderation.observe([chatPost('first')]);
  const pending = moderation.evaluate('first');
  try {
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    if (scenario === 'stop') moderation.stop();
    if (scenario === 'consent') confirmed = false;
    if (scenario === 'key') key = undefined;
    if (scenario === 'ttl') time = 60001;
    // A recreated worker/session may have learned a server Retry-After while local I/O was pending.
    if (scenario === 'cooldown') cooldown = 30000;
    release();
    const result = await pending;
    expect(fetcher).not.toHaveBeenCalled();
    if (scenario === 'consent') expect(result).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'confirmationRequired' } } });
    if (scenario === 'key') expect(result).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'missingKey' } } });
    if (scenario === 'cooldown') expect(result).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'rateLimited', retryAfterMillis: 30000 } } });
  } finally { release?.(); moderation.reset(); await pending; }
});

it('定義読込失敗は固定definitionエラー、Jev通信0、次の待機分も自動送信しない', async () => {
  const fetcher = vi.fn();
  const client = createJevClient(fetcher, async () => { throw new Error('synthetic-private'); });
  const moderation = createModeration({ client, readKey: async () => 'synthetic', readConfirmation: async () => true });
  await moderation.enable(); moderation.observe([chatPost('first'), chatPost('next', 1)]);
  const result = await moderation.evaluate('first');
  expect(result).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'definition' } } });
  await moderation.evaluate('next');
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/synthetic|日本語/);
  moderation.reset();
});
