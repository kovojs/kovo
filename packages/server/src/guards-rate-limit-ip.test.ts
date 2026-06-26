import { describe, expect, it } from 'vitest';

import {
  guards,
  resolveLifecycleRequest,
  type ClientIpRequestLike,
  type SessionRequestLike,
} from './guards.js';

// SPEC §9.5:935 / §10.3:1169-1170: `guards.rateLimit` admits a `per: 'ip'` dimension in addition to
// `per: 'session'`/`'global'`, keying the per-principal budget on the framework-resolved
// `req.clientIp` (see ClientIpRequestLike) the request shell attaches from a trusted source.
interface IpRequest extends SessionRequestLike, ClientIpRequestLike {}

describe("guards.rateLimit({ per: 'ip' }) (capability-gaps §3; SPEC §9.5:935 / §10.3)", () => {
  it('keys by the request IP: same IP shares the budget, different IPs do not', () => {
    const guard = guards.rateLimit<IpRequest>({ per: 'ip', max: 2 });
    const a: IpRequest = { clientIp: '203.0.113.1' };
    const b: IpRequest = { clientIp: '203.0.113.2' };

    expect(guard(a)).toBe(true); // a: 1/2
    expect(guard(a)).toBe(true); // a: 2/2
    expect(guard(a)).toMatchObject({ kind: 'rateLimited' }); // a: over budget

    // A different IP has its own bucket — it is not shed by a's exhausted budget.
    expect(guard(b)).toBe(true); // b: 1/2
    expect(guard(b)).toBe(true); // b: 2/2
    expect(guard(b)).toMatchObject({ kind: 'rateLimited' }); // b: over budget
  });

  it("composes with all(authed, rateLimit({ per: 'ip' })) and keys per IP across principals", async () => {
    const guard = guards.all<IpRequest>(
      guards.authed<IpRequest>(),
      guards.rateLimit<IpRequest>({ per: 'ip', max: 1 }),
    );

    // Two DISTINCT authenticated users behind the SAME IP share one per-IP budget.
    const userOneFromIp: IpRequest = { session: { user: { id: 'u1' } }, clientIp: '198.51.100.7' };
    const userTwoFromIp: IpRequest = { session: { user: { id: 'u2' } }, clientIp: '198.51.100.7' };
    const userThreeOtherIp: IpRequest = {
      session: { user: { id: 'u3' } },
      clientIp: '198.51.100.8',
    };

    expect(await guard(userOneFromIp)).toBe(true); // IP .7: 1/1
    expect(await guard(userTwoFromIp)).toMatchObject({ kind: 'rateLimited' }); // IP .7 shared → shed
    expect(await guard(userThreeOtherIp)).toBe(true); // IP .8: independent budget

    // authed runs first: an unauthenticated caller is denied before rateLimit even reads the IP.
    expect(await guard({ clientIp: '198.51.100.9' })).toMatchObject({ kind: 'unauthenticated' });
  });

  it('the request shell attaches a trustworthy req.clientIp that per:ip keys on', async () => {
    // SPEC §9.5: resolveLifecycleRequest (the request shell) attaches `req.clientIp` from the
    // supplied trusted resolver BEFORE the guard chain, so the guard reads a framework-resolved IP.
    const rawRequest = { headers: { 'x-forwarded-for': 'ignored-untrusted' } };
    const shelled = await resolveLifecycleRequest(rawRequest, { clientIp: () => '192.0.2.55' });
    expect((shelled as ClientIpRequestLike).clientIp).toBe('192.0.2.55');

    const guard = guards.rateLimit<IpRequest>({ per: 'ip', max: 1 });
    expect(guard(shelled as IpRequest)).toBe(true);
    expect(guard(shelled as IpRequest)).toMatchObject({ kind: 'rateLimited' });
  });

  it("per:'ip' fails loud when the shell attached no trustworthy clientIp (no silent shared bucket)", () => {
    // Mirrors the M3 protection for per:'session': refuse to collapse every un-resolved client into
    // one shared `ip:unknown` bucket (a DoS lever). An absent req.clientIp means no trusted source.
    const guard = guards.rateLimit<IpRequest>({ per: 'ip', max: 5 });
    expect(() => guard({})).toThrow(/cannot derive a client IP/);
  });
});
