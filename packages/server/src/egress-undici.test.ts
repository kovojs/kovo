import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { EGRESS_BLOCKED_ERROR_NAME, resolveEgressPolicy } from './egress.js';
import { installUndiciFloor, isUndiciFloorInstalled } from './egress-undici.js';

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
    server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
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

  it('DENIES a fetch to a metadata literal IP', async () => {
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch('http://169.254.169.254/latest/meta-data/')).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'metadata',
    );
  });

  it('DENIES a fetch to a private RFC1918 literal not in allowInternal', async () => {
    uninstall = await installUndiciFloor(resolveEgressPolicy(undefined, () => {}));
    await expect(fetch('http://10.0.5.2:6379/')).rejects.toSatisfy(
      (e) => reason(e) === EGRESS_BLOCKED_ERROR_NAME || reason(e) === 'private-rfc1918',
    );
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
});
