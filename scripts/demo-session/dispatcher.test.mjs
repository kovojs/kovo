import { describe, expect, it } from 'vitest';

import { createPerSessionDispatcher, parseCookies } from './dispatcher.mjs';

// A minimal fake of the Node req/res surface the dispatcher touches.
function fakeReq(cookie) {
  return { headers: cookie ? { cookie } : {}, method: 'GET', url: '/' };
}
function fakeRes() {
  const headers = {};
  return {
    headers,
    getHeader: (name) => headers[name],
    setHeader: (name, value) => {
      headers[name] = value;
    },
    writeHead() {
      return this;
    },
  };
}
function sidFromRes(res) {
  const setCookie = res.getHeader('Set-Cookie');
  if (!setCookie) return undefined;
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return parseCookies(raw.split(';')[0]).kovo_demo_sid;
}

describe('createPerSessionDispatcher', () => {
  it('mints a session + Set-Cookie on first contact and reuses it on the next', async () => {
    let builds = 0;
    const seen = [];
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => {
        const id = builds++;
        return (_req, res) => {
          seen.push(id);
          res.writeHead(200);
        };
      },
    });

    const res1 = fakeRes();
    await dispatcher.dispatch(fakeReq(), res1);
    const sid = sidFromRes(res1);
    expect(sid).toBeTruthy();
    expect(builds).toBe(1);

    // Second request carries the cookie → same instance, no new build.
    const res2 = fakeRes();
    await dispatcher.dispatch(fakeReq(`kovo_demo_sid=${sid}`), res2);
    expect(sidFromRes(res2)).toBeUndefined(); // not re-minted
    expect(builds).toBe(1);
    expect(seen).toEqual([0, 0]);
    expect(dispatcher.size).toBe(1);
  });

  it('isolates state between two different cookies', async () => {
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => {
        let count = 0; // stands in for per-session DB state
        return (_req, res) => {
          count += 1;
          res.writeHead(200);
          res.body = count;
        };
      },
    });

    const a = fakeRes();
    await dispatcher.dispatch(fakeReq(), a);
    const sidA = sidFromRes(a);
    const b = fakeRes();
    await dispatcher.dispatch(fakeReq(), b);
    const sidB = sidFromRes(b);
    expect(sidA).not.toBe(sidB);

    // Hit A twice more, B once; each counts only its own requests.
    const a2 = fakeRes();
    await dispatcher.dispatch(fakeReq(`kovo_demo_sid=${sidA}`), a2);
    const a3 = fakeRes();
    await dispatcher.dispatch(fakeReq(`kovo_demo_sid=${sidA}`), a3);
    expect(a3.body).toBe(3);

    const b2 = fakeRes();
    await dispatcher.dispatch(fakeReq(`kovo_demo_sid=${sidB}`), b2);
    expect(b2.body).toBe(2);
  });

  it('rejects an implausible/hostile cookie by minting a fresh id', async () => {
    const dispatcher = createPerSessionDispatcher({ buildHandler: () => (_r, res) => res.writeHead(200) });
    const res = fakeRes();
    await dispatcher.dispatch(fakeReq('kovo_demo_sid=../etc/passwd'), res);
    expect(sidFromRes(res)).toBeTruthy(); // replaced, not honored
  });

  it('expires idle sessions past the TTL', async () => {
    let clock = 1_000;
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => (_r, res) => res.writeHead(200),
      idleMs: 5_000,
      now: () => clock,
    });
    const res = fakeRes();
    await dispatcher.dispatch(fakeReq(), res);
    const sid = sidFromRes(res);
    expect(dispatcher.size).toBe(1);

    clock += 6_000; // past idle TTL
    const other = fakeRes();
    await dispatcher.dispatch(fakeReq(), other); // sweep runs on dispatch
    expect(dispatcher.sessions.has(sid)).toBe(false);
  });

  it('LRU-evicts beyond maxSessions, keeping the most recently used', async () => {
    let clock = 0;
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => (_r, res) => res.writeHead(200),
      maxSessions: 2,
      now: () => (clock += 1),
    });
    const sids = [];
    for (let i = 0; i < 3; i += 1) {
      const res = fakeRes();
      await dispatcher.dispatch(fakeReq(), res);
      sids.push(sidFromRes(res));
    }
    expect(dispatcher.size).toBe(2);
    expect(dispatcher.sessions.has(sids[0])).toBe(false); // oldest evicted
    expect(dispatcher.sessions.has(sids[2])).toBe(true);
  });

  it('shares one in-flight build across concurrent first requests', async () => {
    let builds = 0;
    let resolveBuild;
    const dispatcher = createPerSessionDispatcher({
      genId: () => 'fixedsid00000000', // both requests use the same minted id path
      buildHandler: () => {
        builds += 1;
        return new Promise((resolve) => {
          resolveBuild = () => resolve((_r, res) => res.writeHead(200));
        });
      },
    });
    const p1 = dispatcher.dispatch(fakeReq('kovo_demo_sid=fixedsid00000000'), fakeRes());
    const p2 = dispatcher.dispatch(fakeReq('kovo_demo_sid=fixedsid00000000'), fakeRes());
    resolveBuild();
    await Promise.all([p1, p2]);
    expect(builds).toBe(1);
  });
});

describe('parseCookies', () => {
  it('parses multiple cookies and url-decodes values', () => {
    expect(parseCookies('a=1; b=hello%20world; c=')).toEqual({ a: '1', b: 'hello world', c: '' });
  });
  it('returns empty for no header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
