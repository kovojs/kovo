// @kovo-security-classifier-corpus egress-ip
// @kovo-security-property-oracle egress-positive-capability
import dns from 'node:dns';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EgressBlockedError,
  frameworkEgressFetch,
  installNetConnectFloor,
  resolveEgressPolicy,
} from './egress.js';
import { installUndiciFloor } from './egress-undici.js';

describe('positive egress capability property oracle (SPEC §6.6 / C9)', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    for (let index = cleanup.length - 1; index >= 0; index -= 1) cleanup[index]!();
    cleanup.length = 0;
    vi.restoreAllMocks();
  });

  it('rejects generated undeclared origin spellings before DNS', async () => {
    installFloor(resolveEgressPolicy({ allowDestinations: ['https://api.example.com'] }, () => {}));
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation((() => {
      throw new Error('undeclared-origin-before-dns-dial');
    }) as typeof dns.lookup);

    let state = configuredEgressFuzzSeed();
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const replay = configuredEgressReplay();
    const candidates: string[] = replay === undefined ? [] : [replay.url];
    if (replay === undefined) {
      const inputBudget = configuredEgressFuzzInputs();
      for (let index = 0; index < inputBudget / 4; index += 1) {
        const token = next().toString(36);
        const port = 1_024 + (next() % 50_000);
        candidates.push(
          `http://api.example.com/${token}`,
          `https://api.example.com:${port}/${token}`,
          `https://${token}.api.example.com/`,
          `https://api.example.com.${token}.invalid/`,
        );
      }
    }

    for (const candidate of candidates) {
      const error = await frameworkEgressFetch(candidate).catch((caught: unknown) => caught);
      try {
        expect(error, candidate).toBeInstanceOf(EgressBlockedError);
        expect(error, candidate).toMatchObject({ reason: 'destination-allowlist' });
      } catch (assertionError) {
        const artifact = persistEgressCounterexample(candidate);
        throw new Error(`normative egress property failed for ${candidate}; replay=${artifact}`, {
          cause: assertionError,
        });
      }
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('strips an application-supplied dispatcher from the sole supported fetch door', async () => {
    const server = http.createServer((_request, response) => response.end('framework-door'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => server.close());
    const port = (server.address() as AddressInfo).port;
    installFloor(
      resolveEgressPolicy(
        {
          allowDestinations: [`http://127.0.0.1:${port}`],
          allowInternal: [`127.0.0.1:${port}`],
        },
        () => {},
      ),
    );
    let attackerDispatches = 0;
    const attackerDispatcher = {
      dispatch() {
        attackerDispatches += 1;
        throw new Error('application dispatcher gained egress authority');
      },
    };

    const response = await frameworkEgressFetch(`http://127.0.0.1:${port}/`, {
      dispatcher: attackerDispatcher,
    } as RequestInit);

    expect(await response.text()).toBe('framework-door');
    expect(attackerDispatches).toBe(0);
  });

  function installFloor(policy: ReturnType<typeof resolveEgressPolicy>): void {
    cleanup.push(installNetConnectFloor(policy));
    cleanup.push(installUndiciFloor(policy));
  }
});

interface EgressCounterexample {
  readonly url: string;
}

function configuredEgressFuzzSeed(): number {
  const source = process.env.KOVO_SECURITY_FUZZ_SEED ?? '0x6b6f766f';
  if (!/^(?:0x[0-9a-f]{1,8}|[0-9]{1,10})$/iu.test(source)) {
    throw new Error('KOVO_SECURITY_FUZZ_SEED must be one unsigned 32-bit integer');
  }
  const seed = Number(source);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('KOVO_SECURITY_FUZZ_SEED must be one unsigned 32-bit integer');
  }
  return seed;
}

function configuredEgressFuzzInputs(): number {
  const source = process.env.KOVO_EGRESS_FUZZ_INPUTS ?? '256';
  if (!/^[1-9][0-9]{0,6}$/u.test(source)) {
    throw new Error('KOVO_EGRESS_FUZZ_INPUTS must be a positive multiple of four up to 1000000');
  }
  const inputs = Number(source);
  if (inputs > 1_000_000 || inputs % 4 !== 0) {
    throw new Error('KOVO_EGRESS_FUZZ_INPUTS must be a positive multiple of four up to 1000000');
  }
  return inputs;
}

function configuredEgressReplay(): EgressCounterexample | undefined {
  const replayPath = process.env.KOVO_EGRESS_FUZZ_REPLAY_FILE;
  if (replayPath === undefined) return undefined;
  const document = JSON.parse(readFileSync(path.resolve(replayPath), 'utf8')) as {
    readonly counterexample?: Partial<EgressCounterexample>;
  };
  if (typeof document.counterexample?.url !== 'string') {
    throw new Error('KOVO_EGRESS_FUZZ_REPLAY_FILE has no replayable counterexample');
  }
  return { url: document.counterexample.url };
}

function persistEgressCounterexample(url: string): string {
  const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const profile = process.env.KOVO_SECURITY_FUZZ_PROFILE ?? 'standalone';
  const relativePath = path.join(
    '.kovo/security-failures/security-fuzz-campaign',
    profile,
    'egress',
    'undeclared-before-dns',
    'minimized-generated-counterexample.json',
  );
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const document = {
    schema: 'kovo.security-fuzz-counterexample/v1',
    campaignVersion: 1,
    family: 'egress',
    caseId: 'undeclared-before-dns',
    classification: 'normative-property-violation',
    safetyVerdict: 'unsafe',
    seed: process.env.KOVO_SECURITY_FUZZ_SEED ?? '0x6b6f766f',
    minimization: 'one generated URL exercising exactly one undeclared-origin spelling',
    counterexample: { url },
    replay: {
      command: `KOVO_EGRESS_FUZZ_REPLAY_FILE=${relativePath} pnpm exec vitest --run packages/server/src/egress-property-oracle.test.ts --testNamePattern 'rejects generated undeclared origin spellings before DNS$' --no-file-parallelism --reporter=dot`,
      environment: { KOVO_EGRESS_FUZZ_REPLAY_FILE: relativePath },
    },
  };
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return relativePath;
}
