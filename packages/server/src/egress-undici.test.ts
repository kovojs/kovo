// @kovo-security-classifier-corpus egress-ip
import http from 'node:http';
import dns from 'node:dns';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EGRESS_BLOCKED_ERROR_NAME,
  frameworkEgressFetch,
  installNetConnectFloor,
  resolveEgressPolicy,
} from './egress.js';
import {
  EgressGatingDispatcher,
  installUndiciFloor,
  isUndiciFloorInstalled,
} from './egress-undici.js';

// Mock the resolver the undici layer uses so a hostname can return a fixed multi-A answer.
// SPEC §6.6 rule 2: the dispatcher resolves with { all: true } and must classify EVERY entry,
// failing the whole request closed when any resolved IP is private/metadata (not just the first).
const { dnsLookupMock } = vi.hoisted(() => ({ dnsLookupMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock }));

/**
 * Layer (a): the undici dispatcher floor. The load-bearing assertion is that POOLED-SOCKET
 * REUSE stays gated — the net.connect layer alone fails open on the second request to an
 * origin (proven separately). These tests use the real global `fetch` (undici) so the
 * `setGlobalDispatcher` interop is exercised end to end on the running Node version.
 */
describe('undici egress floor (layer a): gates every fetch incl. pooled reuse', () => {
  let server: http.Server;
  let port: number;
  let uninstall: (() => void) | undefined;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect-undeclared') {
        res.writeHead(302, { location: 'http://undeclared-hop.invalid/secret' });
        res.end();
        return;
      }
      if (req.url === '/rotation') res.setHeader('connection', 'close');
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '::', () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => server.close());

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  const reason = (e: unknown): string => {
    const err = e as { name?: string; cause?: { name?: string; classification?: string } };
    return err.cause?.name ?? err.cause?.classification ?? err.name ?? String(e);
  };

  it('self-probe: not installed before install, installed after', async () => {
    expect(isUndiciFloorInstalled()).toBe(false);
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    expect(isUndiciFloorInstalled()).toBe(true);
  });

  it('ALLOWS an allowlisted private origin and DENIES the same origin after policy tightens (pooled socket stays gated)', async () => {
    // 1) Allow → first fetch establishes a pooled keep-alive socket.
    uninstall = await installUndiciFloor(
      resolveEgressPolicy({ allowInternal: [`127.0.0.1:${port}`] }, () => {}),
    );
    const allowed = await fetch(`http://127.0.0.1:${port}/a`);
    expect(await allowed.text()).toBe('ok');

    // 2) Tighten policy to deny. The SAME dispatcher updates its policy in place; the next
    //    request to the same origin would reuse the pooled socket and skip net.connect — but
    //    the dispatcher gates it at dispatch().
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch(`http://127.0.0.1:${port}/b`)).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'loopback',
    );
  });

  it('does not reuse an allowlisted private hostname socket after policy tightens and DNS changes', async () => {
    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const allowPolicy = resolveEgressPolicy({ allowInternal: [`localhost:${port}`] }, () => {});
    const uninstallNet = installNetConnectFloor(allowPolicy);
    let uninstallDenyNet: (() => void) | undefined;
    try {
      uninstall = await installUndiciFloor(allowPolicy);
      const allowed = await fetch(`http://localhost:${port}/hostname-a`);
      expect(await allowed.text()).toBe('ok');

      dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
      const denyPolicy = resolveEgressPolicy(undefined, () => {});
      uninstallDenyNet = installNetConnectFloor(denyPolicy);
      uninstall = await installUndiciFloor(denyPolicy);

      await expect(fetch(`http://localhost:${port}/hostname-b`)).rejects.toSatisfy(
        (error) => reason(error) === EGRESS_BLOCKED_ERROR_NAME || reason(error) === 'loopback',
      );
    } finally {
      uninstallDenyNet?.();
      uninstallNet();
    }
  });

  it('rotates policy generations without consulting a late Map.values replacement', () => {
    const policy = resolveEgressPolicy(undefined, () => {});
    const uninstallOlder = installUndiciFloor(policy);
    const originalValues = Map.prototype.values;
    let poisonCalls = 0;
    let installFailure: unknown;
    let uninstallCurrent: (() => void) | undefined;

    try {
      Map.prototype.values = function poisonedMapValues() {
        poisonCalls += 1;
        throw new Error('late Map.values replacement reached Undici teardown');
      } as typeof Map.prototype.values;
      try {
        uninstallCurrent = installUndiciFloor(policy);
      } catch (error) {
        installFailure = error;
      }
    } finally {
      Map.prototype.values = originalValues;
    }

    const cleanup = uninstallCurrent ?? installUndiciFloor(policy);
    try {
      expect(installFailure).toBeUndefined();
      expect(poisonCalls).toBe(0);
      expect(isUndiciFloorInstalled()).toBe(true);
    } finally {
      cleanup();
      uninstallOlder();
    }
  });

  it('DENIES a fetch to a metadata literal IP', async () => {
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch('http://169.254.169.254/latest/meta-data/')).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'metadata',
    );
  });

  it('rejects an undeclared redirect origin before DNS or dial', async () => {
    dnsLookupMock.mockReset();
    dnsLookupMock.mockRejectedValue(new Error('undeclared redirect reached DNS'));
    const policy = resolveEgressPolicy(
      {
        allowDestinations: [`http://127.0.0.1:${port}`],
        allowInternal: [`127.0.0.1:${port}`],
      },
      () => {},
    );
    const uninstallNet = installNetConnectFloor(policy);
    try {
      uninstall = installUndiciFloor(policy);
      const outcome = await frameworkEgressFetch(
        `http://127.0.0.1:${port}/redirect-undeclared`,
      ).catch((error: unknown) => error);

      expect(reason(outcome)).toBe(EGRESS_BLOCKED_ERROR_NAME);
      expect(dnsLookupMock).not.toHaveBeenCalled();
    } finally {
      uninstallNet();
    }
  });

  it('re-resolves a declared framework origin on every request while keeping the origin closed', async () => {
    dnsLookupMock.mockReset();
    dnsLookupMock
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '::1', family: 6 }]);
    let initialLookup = 0;
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(((_host, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        error: Error | null,
        addresses: { address: string; family: number }[],
      ) => void;
      initialLookup += 1;
      cb(null, [
        initialLookup <= 2 ? { address: '127.0.0.1', family: 4 } : { address: '::1', family: 6 },
      ]);
    }) as typeof dns.lookup);
    const policy = resolveEgressPolicy(
      {
        allowDestinations: [`http://localhost:${port}`],
        allowInternal: [`localhost:${port}`],
      },
      () => {},
    );
    const uninstallNet = installNetConnectFloor(policy);
    try {
      uninstall = installUndiciFloor(policy);
      for (let iteration = 0; iteration < 2; iteration += 1) {
        const response = await frameworkEgressFetch(`http://localhost:${port}/rotation`, {
          headers: { connection: 'close' },
        });
        expect(await response.text()).toBe('ok');
      }

      expect(dnsLookupMock).toHaveBeenCalledTimes(2);
      // Each request performs one framework preclassification and one independently pinned
      // net-layer dial lookup. The second request rotates both answers from IPv4 to IPv6.
      expect(initialLookup).toBe(4);
      await expect(frameworkEgressFetch(`http://127.0.0.2:${port}/rotation`)).rejects.toMatchObject(
        { reason: 'destination-allowlist' },
      );
    } finally {
      lookup.mockRestore();
      uninstallNet();
    }
  });

  it('DENIES a fetch to a private RFC1918 literal not in allowInternal', async () => {
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch('http://10.0.5.2:6379/')).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'private-rfc1918',
    );
  });

  it('gates IANA-special redirect/reuse hops before the dispatcher connector', async () => {
    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '2620:4f:8000::1', family: 6 }]);
    const connector = vi.fn((_options: unknown, callback: (error: Error, socket: null) => void) => {
      callback(new Error('synthetic connector stop'), null);
    });
    const dispatcher = new EgressGatingDispatcher(
      resolveEgressPolicy(undefined, () => {}),
      {
        connect: connector,
      },
    );

    try {
      await expect(
        dispatcher.request({ method: 'GET', origin: 'http://192.31.196.1', path: '/' }),
      ).rejects.toMatchObject({ classification: 'special-use' });
      await expect(
        dispatcher.request({
          method: 'GET',
          origin: 'http://iana-special-redirect-hop.test',
          path: '/',
        }),
      ).rejects.toMatchObject({ classification: 'special-use' });
      expect(connector).not.toHaveBeenCalled();

      await dispatcher
        .request({ method: 'GET', origin: 'http://192.31.195.255', path: '/' })
        .catch(() => undefined);
      expect(connector).toHaveBeenCalledOnce();
    } finally {
      await dispatcher.close();
    }
  });

  it('denies a mixed DNS answer containing metadata under an operator Pref64', async () => {
    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:1234:5678::a9fe:a9fe', family: 6 },
    ]);
    const connector = vi.fn((_options: unknown, callback: (error: Error, socket: null) => void) => {
      callback(new Error('synthetic connector stop'), null);
    });
    const dispatcher = new EgressGatingDispatcher(
      resolveEgressPolicy({ nat64Prefixes: ['2606:4700:1234:5678::/96'] }, () => {}),
      { connect: connector },
    );

    try {
      await expect(
        dispatcher.request({ method: 'GET', origin: 'http://dns64-mixed.test', path: '/' }),
      ).rejects.toMatchObject({ classification: 'metadata' });
      expect(connector).not.toHaveBeenCalled();
    } finally {
      await dispatcher.close();
    }
  });

  it('binds the checked literal host to native URL bytes after late String.replace poisoning', async () => {
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    const originalReplace = String.prototype.replace;
    let lied = false;
    let outcome: unknown;
    try {
      String.prototype.replace = function (search, replacement) {
        if (!lied && this.valueOf() === '127.0.0.1') {
          lied = true;
          return '8.8.8.8';
        }
        return originalReplace.call(this, search, replacement as string);
      };
      outcome = await fetch(`http://127.0.0.1:${port}/late-replace`).catch(
        (error: unknown) => error,
      );
    } finally {
      String.prototype.replace = originalReplace;
    }

    expect(reason(outcome)).toMatch(/EgressBlockedError|loopback/);
  });

  it('does not accept a forged public resolution from late Map.get poisoning', async () => {
    dnsLookupMock.mockImplementationOnce(() =>
      Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    );
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    const originalGet = Map.prototype.get;
    let outcome: unknown;
    try {
      Map.prototype.get = function (key) {
        if (key === 'localhost') return { expires: Number.POSITIVE_INFINITY, ip: '8.8.8.8' };
        return originalGet.call(this, key);
      };
      outcome = await fetch(`http://localhost:${port}/late-map`).catch((error: unknown) => error);
    } finally {
      Map.prototype.get = originalGet;
    }

    expect(reason(outcome)).toMatch(/EgressBlockedError|loopback/);
  });

  it('ALLOWS a fetch to a private literal that IS in allowInternal (reaches the loopback test server)', async () => {
    uninstall = await installUndiciFloor(
      resolveEgressPolicy({ allowInternal: [`127.0.0.1:${port}`] }, () => {}),
    );
    const res = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(await res.text()).toBe('ok');
  });

  // SPEC §6.6 rule 2 / bugz H2: a hostname whose multi-A answer mixes a public IP with a
  // private/metadata sibling must be blocked wholesale — the dispatcher resolves { all: true }
  // and classifies every record, not just address[0]. The mock is options-aware so that the
  // OLD single-address resolution (`dnsLookup(host)`) would have seen ONLY the passing public
  // record and forwarded the request; the fix resolves all and sees the private sibling.
  const setMultiA = (addresses: { address: string; family: number }[]): void => {
    dnsLookupMock.mockImplementationOnce((_host: string, opts?: { all?: boolean }) =>
      Promise.resolve(opts?.all ? addresses : addresses[0]),
    );
  };

  it('DENIES a hostname whose multi-A answer mixes a public IP with a metadata sibling', async () => {
    setMultiA([
      { address: '8.8.8.8', family: 4 }, // OLD code would see only this and pass
      { address: '169.254.169.254', family: 4 },
    ]);
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch('http://rebind-metadata.test/')).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'metadata',
    );
  });

  it('DENIES a hostname whose multi-A answer mixes a public IP with a loopback sibling', async () => {
    setMultiA([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch('http://rebind-loopback.test/')).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'loopback',
    );
  });

  it('bounds the process-lifetime hostname resolution cache', async () => {
    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const dispatcher = new EgressGatingDispatcher(
      resolveEgressPolicy(undefined, () => {}),
      {
        connect(_options, callback) {
          callback(new Error('synthetic connector stop'), null);
        },
      },
    );

    try {
      for (let index = 0; index <= 256; index += 1) {
        await dispatcher
          .request({ method: 'GET', origin: `http://cache-${index}.example`, path: '/' })
          .catch(() => undefined);
      }
      dnsLookupMock.mockClear();

      await dispatcher
        .request({ method: 'GET', origin: 'http://cache-0.example', path: '/' })
        .catch(() => undefined);

      expect(dnsLookupMock).toHaveBeenCalledOnce();
    } finally {
      await dispatcher.close();
    }
  });
});
