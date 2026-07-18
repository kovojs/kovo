// @kovo-security-classifier-corpus egress-ip
// @kovo-security-property-oracle egress-positive-capability
import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

    let state = 0x6b6f_766f;
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const candidates: string[] = [];
    for (let index = 0; index < 64; index += 1) {
      const token = next().toString(36);
      const port = 1_024 + (next() % 50_000);
      candidates.push(
        `http://api.example.com/${token}`,
        `https://api.example.com:${port}/${token}`,
        `https://${token}.api.example.com/`,
        `https://api.example.com.${token}.invalid/`,
      );
    }

    for (const candidate of candidates) {
      const error = await frameworkEgressFetch(candidate).catch((caught: unknown) => caught);
      expect(error, candidate).toBeInstanceOf(EgressBlockedError);
      expect(error, candidate).toMatchObject({ reason: 'destination-allowlist' });
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
