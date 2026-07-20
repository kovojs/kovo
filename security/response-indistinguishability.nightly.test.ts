import { describe, expect, it, vi } from 'vitest';

vi.mock('../packages/better-auth/src/internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

import { normalizeBetterAuthAccountOperation } from '../packages/better-auth/src/response-observation.js';
import { hashPassword, verifyCredential } from '../packages/server/src/password.js';
import {
  evaluateTimingBudget,
  loadNightlyTimingBudget,
  measureAlternatingWorlds,
  persistTimingCounterexample,
} from '../scripts/response-indistinguishability-timing-oracle.mjs';

const describeNightly = process.env.KOVO_RESPONSE_TIMING_ORACLE === '1' ? describe : describe.skip;

describeNightly('nightly response indistinguishability', () => {
  const budget = loadNightlyTimingBudget();

  it('keeps present and absent credential verification inside the versioned timing budget', async () => {
    const digest = await hashPassword('nightly correct password');
    const samples = await measureAlternatingWorlds({
      sampleSize: budget.sampleSize,
      warmupSamples: budget.warmupSamples,
      worldA: () => verifyCredential('nightly candidate password', digest),
      worldB: () => verifyCredential('nightly candidate password', undefined),
    });
    const verdict = evaluateTimingBudget(samples.samplesA, samples.samplesB, budget);
    if (!verdict.ok) {
      persistTimingCounterexample({
        budget,
        directory: budget.counterexampleDirectory,
        ...samples,
        surface: 'server.password-credential',
      });
    }
    expect(verdict).toMatchObject({ ok: true });
  }, 120_000);

  it('keeps Better Auth accepted/rejected body normalization inside the same budget', async () => {
    const accepted = { redirectTo: '/', status: 'accepted' as const };
    const samples = await measureAlternatingWorlds({
      sampleSize: budget.sampleSize,
      warmupSamples: budget.warmupSamples,
      worldA: () =>
        normalizeBetterAuthAccountOperation(
          new Response(JSON.stringify({ user: { id: 'private' } }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
          accepted,
        ),
      worldB: () =>
        normalizeBetterAuthAccountOperation(
          new Response(JSON.stringify({ error: 'USER_ALREADY_EXISTS' }), {
            headers: { 'content-type': 'application/json' },
            status: 422,
          }),
          accepted,
        ),
    });
    const verdict = evaluateTimingBudget(samples.samplesA, samples.samplesB, budget);
    if (!verdict.ok) {
      persistTimingCounterexample({
        budget,
        directory: budget.counterexampleDirectory,
        ...samples,
        surface: 'better-auth.account-handler',
      });
    }
    expect(verdict).toMatchObject({ ok: true });
  });
});
