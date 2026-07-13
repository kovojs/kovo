import { afterAll, describe, expect, it } from 'vitest';

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';

const [{ createApp }, replayApi, webhookApi, { s }] = await Promise.all([
  import('./app.js?volatile-replay-production'),
  import('./replay.js'),
  import('./webhook.js?volatile-replay-production'),
  import('./schema.js?volatile-replay-production'),
]);

afterAll(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe('production replay truth posture', () => {
  it('refuses the framework memory mutation store at app boot', () => {
    expect(() =>
      createApp({ mutationReplayStore: replayApi.createMemoryMutationReplayStore() }),
    ).toThrow(/KV436.*volatile memory mutationReplayStore.*createPostgresMutationReplayStore/);
  });

  it('refuses the framework memory webhook store at declaration', () => {
    expect(() =>
      webhookApi.webhook('/webhooks/volatile', {
        handler() {},
        idempotency: (input) => input.id,
        input: s.object({ id: s.string() }),
        replayStore: webhookApi.createMemoryWebhookReplayStore(),
        verify: 'none',
        verifyJustification: 'production posture test fixture',
      }),
    ).toThrow(/KV436.*volatile memory replayStore.*createPostgresWebhookReplayStore/);
  });
});
