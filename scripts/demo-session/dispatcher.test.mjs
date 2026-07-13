import { describe, expect, it } from 'vitest';

import { createPerSessionDispatcher, DEMO_SESSION_HEADER, parseCookies } from './dispatcher.mjs';

// A minimal fake of the Node req/res surface the dispatcher touches.
function fakeReq(cookie) {
  return { headers: cookie ? { cookie } : {}, method: 'GET', url: '/' };
}
function fakeRes() {
  const headers = {};
  return {
    body: undefined,
    headers,
    getHeader: (name) => headers[name],
    end(body) {
      this.body = body;
      return this;
    },
    setHeader: (name, value) => {
      headers[name] = value;
    },
    writeHead(status, responseHeaders = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(responseHeaders)) headers[name] = value;
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
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => (_r, res) => res.writeHead(200),
    });
    const res = fakeRes();
    await dispatcher.dispatch(fakeReq('kovo_demo_sid=../etc/passwd'), res);
    expect(sidFromRes(res)).toBeTruthy(); // replaced, not honored
  });

  it('does not let a valid but unknown caller-chosen UUID name a session', async () => {
    const offered = '00000000-0000-4000-8000-000000000001';
    const minted = '00000000-0000-4000-8000-000000000002';
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => (_r, res) => res.writeHead(200),
      genId: () => minted,
    });
    const res = fakeRes();
    await dispatcher.dispatch(fakeReq(`kovo_demo_sid=${offered}`), res);
    expect(sidFromRes(res)).toBe(minted);
    expect(dispatcher.sessions.has(offered)).toBe(false);
    expect(dispatcher.sessions.has(minted)).toBe(true);
  });

  it('ignores a malformed encoded cookie and mints a fresh isolation id', async () => {
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => (_r, res) => res.writeHead(200),
    });
    const res = fakeRes();
    await expect(dispatcher.dispatch(fakeReq('kovo_demo_sid=%'), res)).resolves.toBe(res);
    expect(sidFromRes(res)).toBeTruthy();
  });

  it('uses a host-only secure HttpOnly isolation cookie in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const dispatcher = createPerSessionDispatcher({
        buildHandler: () => (_r, res) => res.writeHead(200),
      });
      const res = fakeRes();
      await dispatcher.dispatch(fakeReq(), res);
      const setCookie = res.getHeader('Set-Cookie').join('\n');
      expect(setCookie).toContain('__Host-kovo_demo_sid=');
      expect(setCookie).toContain('; Path=/; HttpOnly; Secure; SameSite=Lax');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('overwrites the internal session header with the resolved cookie session', async () => {
    const seen = [];
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => (req, res) => {
        seen.push(req.headers[DEMO_SESSION_HEADER]);
        res.writeHead(200);
      },
    });

    const firstRes = fakeRes();
    await dispatcher.dispatch(fakeReq(), firstRes);
    const sid = sidFromRes(firstRes);
    await dispatcher.dispatch(
      {
        headers: { cookie: `kovo_demo_sid=${sid}`, [DEMO_SESSION_HEADER]: 'spoofed' },
        method: 'GET',
        url: '/',
      },
      fakeRes(),
    );

    expect(seen).toEqual([sid, sid]);
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

  it('refuses excess visitors before starting untracked concurrent builds', async () => {
    let builds = 0;
    const releases = [];
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => {
        builds += 1;
        return new Promise((resolve) => {
          releases.push(() => resolve((_req, res) => res.writeHead(200)));
        });
      },
      maxSessions: 2,
    });

    const first = dispatcher.dispatch(fakeReq(), fakeRes());
    const second = dispatcher.dispatch(fakeReq(), fakeRes());
    const refused = fakeRes();
    await dispatcher.dispatch(fakeReq(), refused);

    expect(builds).toBe(2);
    expect(dispatcher.size).toBe(2);
    expect(refused.status).toBe(503);
    expect(refused.headers).toMatchObject({
      'cache-control': 'no-store',
      'retry-after': '1',
    });
    expect(refused.getHeader('Set-Cookie')).toBeUndefined();

    for (const release of releases) release();
    await Promise.all([first, second]);
  });

  it('shares one in-flight build across concurrent first requests', async () => {
    let builds = 0;
    let resolveBuild;
    const dispatcher = createPerSessionDispatcher({
      genId: () => '00000000-0000-4000-8000-000000000001', // both requests use the same minted id path
      buildHandler: () => {
        builds += 1;
        return new Promise((resolve) => {
          resolveBuild = () => resolve((_r, res) => res.writeHead(200));
        });
      },
    });
    const p1 = dispatcher.dispatch(
      fakeReq('kovo_demo_sid=00000000-0000-4000-8000-000000000001'),
      fakeRes(),
    );
    const p2 = dispatcher.dispatch(
      fakeReq('kovo_demo_sid=00000000-0000-4000-8000-000000000001'),
      fakeRes(),
    );
    resolveBuild();
    await Promise.all([p1, p2]);
    expect(builds).toBe(1);
  });

  it('prebuilds warm session handlers and replenishes after a new visitor consumes one', async () => {
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
      warmSessions: 2,
    });

    await dispatcher.ready();
    expect(builds).toBe(2);
    expect(dispatcher.warmSize).toBe(2);

    const res = fakeRes();
    await dispatcher.dispatch(fakeReq(), res);
    expect(sidFromRes(res)).toBeTruthy();
    expect(seen).toEqual([0]);
    expect(dispatcher.size).toBe(1);

    await dispatcher.ready();
    expect(builds).toBe(3);
    expect(dispatcher.warmSize).toBe(2);
  });

  it('claims an in-flight warmup for the first visitor instead of starting a competing build', async () => {
    let builds = 0;
    let resolveBuild;
    const seen = [];
    const dispatcher = createPerSessionDispatcher({
      buildHandler: () => {
        const id = builds++;
        return new Promise((resolve) => {
          resolveBuild = () =>
            resolve((_req, res) => {
              seen.push(id);
              res.writeHead(200);
            });
        });
      },
      warmSessions: 1,
    });

    const ready = dispatcher.ready();
    await Promise.resolve();
    expect(builds).toBe(1);

    const dispatch = dispatcher.dispatch(fakeReq(), fakeRes());
    await Promise.resolve();
    expect(builds).toBe(1);

    resolveBuild();
    await dispatch;
    expect(seen).toEqual([0]);

    await Promise.resolve();
    expect(builds).toBe(2);
    resolveBuild();
    await ready;
    expect(builds).toBe(2);
    expect(dispatcher.warmSize).toBe(1);
  });
});

describe('parseCookies', () => {
  it('parses multiple cookies and url-decodes values', () => {
    expect(parseCookies('a=1; b=hello%20world; c=')).toEqual({ a: '1', b: 'hello world', c: '' });
  });
  it('ignores malformed encoded values instead of throwing', () => {
    expect(parseCookies('broken=%; safe=value')).toEqual({ safe: 'value' });
  });
  it('returns empty for no header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
