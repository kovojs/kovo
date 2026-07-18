import { describe, expect, it } from 'vitest';

import {
  assertParanoidPostgresCasesExecuted,
  requireParanoidPostgresToolchain,
} from './index.build.prod-artifact.paranoid-runtime-gate.js';

describe('paranoid authorization acceptance gate', () => {
  it('fails closed when the dedicated gate cannot find the local Postgres toolchain', () => {
    expect(() =>
      requireParanoidPostgresToolchain(
        { available: false, reason: 'missing local Postgres binaries: initdb, postgres' },
        true,
      ),
    ).toThrow(
      'test:authz-paranoid requires a local Postgres toolchain: missing local Postgres binaries: initdb, postgres',
    );
  });

  it('allows an ordinary non-paranoid run to skip unavailable real-Postgres cases', () => {
    expect(
      requireParanoidPostgresToolchain(
        { available: false, reason: 'missing local Postgres binaries: initdb, postgres' },
        false,
      ),
    ).toBe(false);
  });

  it('fails when any required real-Postgres acceptance case did not execute', () => {
    expect(() =>
      assertParanoidPostgresCasesExecuted(
        ['phase5-dogfood', 'provision-check-boot', 'leak-refusal'],
        new Set(['phase5-dogfood', 'leak-refusal']),
        true,
      ),
    ).toThrow(
      'test:authz-paranoid did not execute every required real-Postgres case; missing: provision-check-boot',
    );

    expect(() =>
      assertParanoidPostgresCasesExecuted(
        ['phase5-dogfood', 'provision-check-boot', 'leak-refusal'],
        new Set(['phase5-dogfood', 'provision-check-boot', 'leak-refusal']),
        true,
      ),
    ).not.toThrow();
  });
});
