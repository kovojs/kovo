import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent, setGlobalDispatcher } from 'undici';

import { createApp } from './app.js';
import { EGRESS_BLOCKED_ERROR_NAME, EgressConfigError } from './egress.js';
import {
  EgressFloorBootError,
  activeEgressFloor,
  installEgressFloor,
  registerEgressDatabaseUrl,
  selfProbe,
} from './egress-bootstrap.js';
import { awsCredential, azureCredential, gcpCredential } from './egress-credentials.js';

describe('egress bootstrap: dual-layer install + self-probe', () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    activeEgressFloor()?.uninstall();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    activeEgressFloor()?.uninstall();
    vi.restoreAllMocks();
  });

  it('self-probe LOUDLY warns when the floor is not installed', () => {
    const warnings: string[] = [];
    const probe = selfProbe((m) => warnings.push(m));
    expect(probe.netConnectInstalled).toBe(false);
    expect(probe.undiciInstalled).toBe(false);
    expect(warnings.join('\n')).toContain('NOT installed');
  });

  it('worker/child-process starter self-probes can fail loudly when bootstrap omitted', () => {
    expect(() => selfProbe(() => {}, { boundary: 'worker', failure: 'throw' })).toThrow(
      /NOT installed.*worker/,
    );

    const warnings: string[] = [];
    selfProbe((m) => warnings.push(m), { boundary: 'child-process' });
    expect(warnings.join('\n')).toContain('child-process');
    expect(warnings.join('\n')).toContain('NOT installed');
  });

  it('installs both layers and the self-probe goes quiet', async () => {
    const warnings: string[] = [];
    const install = await installEgressFloor({ allowInternal: [] }, (m) => warnings.push(m));
    teardown = install.uninstall;
    expect(install.netConnectInstalled).toBe(true);
    expect(install.undiciInstalled).toBe(true);
    const probe = selfProbe((m) => warnings.push(m));
    expect(probe.netConnectInstalled).toBe(true);
    expect(probe.undiciInstalled).toBe(true);
    expect(warnings.join('\n')).not.toContain('NOT installed');
    expect(warnings.join('\n')).not.toContain('PARTIALLY');
  });

  it('does not dispatch a late Promise.resolve replacement for install authority', async () => {
    const nativeResolve = Promise.resolve;
    let resolveHits = 0;
    Promise.resolve = function poisonedResolve(value?: unknown) {
      resolveHits += 1;
      return Reflect.apply(nativeResolve, Promise, [value]);
    } as typeof Promise.resolve;
    let installing: ReturnType<typeof installEgressFloor>;
    try {
      installing = installEgressFloor({ allowInternal: [] }, () => {});
    } finally {
      Promise.resolve = nativeResolve;
    }

    const install = await installing;
    teardown = install.uninstall;
    expect(install.netConnectInstalled).toBe(true);
    expect(install.undiciInstalled).toBe(true);
    expect(resolveHits).toBe(0);
  });

  it('warns when net.Socket.prototype.connect is re-patched after install', async () => {
    const warnings: string[] = [];
    const install = await installEgressFloor({ allowInternal: [], hardening: 'warn' }, (m) =>
      warnings.push(m),
    );
    teardown = install.uninstall;

    const replacement = function replacedConnect(
      this: net.Socket,
      ..._args: unknown[]
    ): net.Socket {
      return this;
    };
    net.Socket.prototype.connect = replacement as typeof net.Socket.prototype.connect;

    expect(warnings.join('\n')).toContain('TAMPER');
    const probe = selfProbe((m) => warnings.push(m));
    expect(probe.netConnectInstalled).toBe(false);
    expect(warnings.join('\n')).toContain('net.Socket.prototype.connect no longer points');
  });

  it('warns when undici setGlobalDispatcher replaces the floor after install', async () => {
    const warnings: string[] = [];
    const install = await installEgressFloor({ allowInternal: [] }, (m) => warnings.push(m));
    teardown = install.uninstall;

    const replacement = new Agent();
    setGlobalDispatcher(replacement);
    const probe = selfProbe((m) => warnings.push(m));
    expect(probe.undiciInstalled).toBe(false);
    expect(warnings.join('\n')).toContain('setGlobalDispatcher');
    await replacement.close();
  });

  it('refuses boot synchronously on a metadata IP in allowInternal', () => {
    expect(() => installEgressFloor({ allowInternal: ['169.254.169.254:80'] }, () => {})).toThrow(
      EgressConfigError,
    );
  });

  it('end-to-end: createApp() installs a dev-lenient floor and allows loopback', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createApp();
    teardown = activeEgressFloor()?.uninstall;

    const ok = await fetch(`http://127.0.0.1:${port}/`);
    expect(await ok.text()).toBe('ok');
    await expect(fetch('http://169.254.169.254/latest/meta-data/')).rejects.toBeDefined();
    expect(warn.mock.calls.join('\n')).toContain('metadata remains blocked');

    server.close();
  });

  it('end-to-end: createApp({ egress: { allowInternal: [] } }) denies loopback in development', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    createApp({ egress: { allowInternal: [] } });
    teardown = activeEgressFloor()?.uninstall;

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeDefined();

    server.close();
  });

  it('permits a framework-registered database endpoint after the floor is installed', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    const install = await installEgressFloor({ allowInternal: [] }, () => {});
    teardown = install.uninstall;

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeDefined();
    const unregister = registerEgressDatabaseUrl(`postgres://app@127.0.0.1:${port}/kovo`);
    try {
      const ok = await fetch(`http://127.0.0.1:${port}/`);
      expect(await ok.text()).toBe('ok');
    } finally {
      unregister();
    }
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeDefined();

    server.close();
  });

  it('removes a database endpoint exemption after app code poisons collection methods', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const endpoint = `127.0.0.1:${port}`;
    const previousDatabaseUrl = process.env.KOVO_DATABASE_URL;
    delete process.env.KOVO_DATABASE_URL;

    const install = await installEgressFloor({ allowInternal: [] }, () => {});
    teardown = install.uninstall;
    const unregister = registerEgressDatabaseUrl(`postgres://app@${endpoint}/kovo`);
    const nativeMapGet = Map.prototype.get;
    const nativeMapSet = Map.prototype.set;
    const nativeMapDelete = Map.prototype.delete;
    const nativeArrayIncludes = Array.prototype.includes;
    const nativeArrayPush = Array.prototype.push;
    const poisonHits = { delete: 0, get: 0, includes: 0, push: 0, set: 0 };

    try {
      const allowed = await fetch(`http://${endpoint}/`);
      expect(await allowed.text()).toBe('ok');

      Map.prototype.get = function poisonedDatabaseEndpointGet(key: unknown) {
        if (key === endpoint) poisonHits.get += 1;
        return Reflect.apply(nativeMapGet, this, [key]);
      } as typeof Map.prototype.get;
      Map.prototype.set = function poisonedDatabaseEndpointSet(key: unknown, value: unknown) {
        if (key === endpoint) poisonHits.set += 1;
        return Reflect.apply(nativeMapSet, this, [key, value]);
      } as typeof Map.prototype.set;
      Map.prototype.delete = function poisonedDatabaseEndpointDelete(key: unknown) {
        if (key === endpoint) poisonHits.delete += 1;
        return Reflect.apply(nativeMapDelete, this, [key]);
      } as typeof Map.prototype.delete;
      Array.prototype.includes = function poisonedDatabaseEndpointIncludes(
        searchElement: unknown,
        fromIndex?: number,
      ) {
        if (searchElement === endpoint) poisonHits.includes += 1;
        return Reflect.apply(nativeArrayIncludes, this, [searchElement, fromIndex]);
      } as typeof Array.prototype.includes;
      Array.prototype.push = function poisonedDatabaseEndpointPush(...values: unknown[]) {
        if (values[0] === endpoint) {
          poisonHits.push += 1;
          return this.length;
        }
        return Reflect.apply(nativeArrayPush, this, values);
      } as typeof Array.prototype.push;

      unregister();
    } finally {
      Map.prototype.get = nativeMapGet;
      Map.prototype.set = nativeMapSet;
      Map.prototype.delete = nativeMapDelete;
      Array.prototype.includes = nativeArrayIncludes;
      Array.prototype.push = nativeArrayPush;
    }

    try {
      expect(poisonHits).toEqual({ delete: 0, get: 0, includes: 0, push: 0, set: 0 });
      await expect(fetch(`http://${endpoint}/`)).rejects.toBeDefined();
    } finally {
      unregister();
      server.close();
      if (previousDatabaseUrl === undefined) delete process.env.KOVO_DATABASE_URL;
      else process.env.KOVO_DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('carries a pre-registered database endpoint into a later floor install', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    const unregister = registerEgressDatabaseUrl(`postgres://app@127.0.0.1:${port}/kovo`);
    const install = await installEgressFloor({ allowInternal: [] }, () => {});
    teardown = install.uninstall;

    try {
      const ok = await fetch(`http://127.0.0.1:${port}/`);
      expect(await ok.text()).toBe('ok');
    } finally {
      unregister();
    }
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeDefined();

    server.close();
  });

  it('end-to-end: createApp({ egress }) keeps explicit internal allowlist semantics', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    createApp({ egress: { allowInternal: [`127.0.0.1:${port}`] } });
    teardown = activeEgressFloor()?.uninstall;

    // The allowlisted loopback origin is reachable.
    const ok = await fetch(`http://127.0.0.1:${port}/`);
    expect(await ok.text()).toBe('ok');

    // A different, non-allowlisted private literal is denied.
    await expect(fetch('http://10.0.5.2:6379/')).rejects.toBeDefined();

    server.close();
  });

  it('refuses production boot when egress is disabled without an audited opt-out', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createApp({ egress: false })).toThrow(EgressFloorBootError);
      expect(() => createApp({ egress: { enabled: false, justification: '' } })).toThrow(
        EgressFloorBootError,
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('cannot forge an audited production egress opt-out with late String.trim poison', () => {
    const previous = process.env.NODE_ENV;
    const originalTrim = String.prototype.trim;
    process.env.NODE_ENV = 'production';
    let failure: unknown;
    try {
      String.prototype.trim = () => 'forged-audit-justification';
      try {
        createApp({ egress: { enabled: false, justification: '' } });
      } catch (error) {
        failure = error;
      }
    } finally {
      String.prototype.trim = originalTrim;
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }

    expect(failure).toBeInstanceOf(EgressFloorBootError);
  });

  it('rejects accessor-backed egress opt-out authority without invoking it', () => {
    let reads = 0;
    const egress = { enabled: false } as { enabled: false; justification: string };
    Object.defineProperty(egress, 'justification', {
      enumerable: true,
      get() {
        reads += 1;
        return 'forged external boundary';
      },
    });

    expect(() => createApp({ egress })).toThrow(/stable own data properties/);
    expect(reads).toBe(0);
  });

  it('installs a production default empty-allowlist floor and denies loopback', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      createApp();
      teardown = activeEgressFloor()?.uninstall;
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toBeDefined();
    } finally {
      server.close();
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('production default exempts only KOVO_DATABASE_URL host:port from the private-network floor', async () => {
    const dbServer = http.createServer((_req, res) => res.end('db-ok'));
    const otherServer = http.createServer((_req, res) => res.end('other-ok'));
    await new Promise<void>((r) => dbServer.listen(0, '127.0.0.1', () => r()));
    await new Promise<void>((r) => otherServer.listen(0, '127.0.0.1', () => r()));
    const dbPort = (dbServer.address() as AddressInfo).port;
    const otherPort = (otherServer.address() as AddressInfo).port;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDatabaseUrl = process.env.KOVO_DATABASE_URL;
    process.env.NODE_ENV = 'production';
    process.env.KOVO_DATABASE_URL = `postgres://app@127.0.0.1:${dbPort}/app`;
    try {
      createApp();
      teardown = activeEgressFloor()?.uninstall;

      const ok = await fetch(`http://127.0.0.1:${dbPort}/`);
      expect(await ok.text()).toBe('db-ok');
      await expect(fetch(`http://127.0.0.1:${otherPort}/`)).rejects.toMatchObject({
        cause: { name: EGRESS_BLOCKED_ERROR_NAME },
      });
      await expect(fetch('http://169.254.169.254/latest/meta-data/')).rejects.toBeDefined();
    } finally {
      dbServer.close();
      otherServer.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDatabaseUrl === undefined) delete process.env.KOVO_DATABASE_URL;
      else process.env.KOVO_DATABASE_URL = previousDatabaseUrl;
    }
  });

  it('allows an audited production opt-out and leaves the process floor absent', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        createApp({
          egress: {
            enabled: false,
            justification: 'runtime runs behind a platform egress proxy with IMDS blocked',
          },
        }),
      ).not.toThrow();
      expect(activeEgressFloor()).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('keeps development lenient for unaudited disable but warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => createApp({ egress: false })).not.toThrow();
    expect(activeEgressFloor()).toBeUndefined();
    expect(warn.mock.calls.join('\n')).toContain('Development stays lenient');
  });

  it('refuses createApp boot synchronously on a metadata IP in allowInternal', () => {
    expect(() => createApp({ egress: { allowInternal: ['169.254.169.254:80'] } })).toThrow(
      EgressConfigError,
    );
  });

  it('kovo.awsCredential() opens the metadata frame; a bare fetch outside it does not', async () => {
    const install = await installEgressFloor(undefined, () => {});
    teardown = install.uninstall;

    // Outside the frame: metadata literal is denied at connect.
    let outsideErr: unknown;
    try {
      http.get({ host: '169.254.169.254', port: 80 });
    } catch (e) {
      outsideErr = e;
    }
    expect((outsideErr as Error).name).toBe(EGRESS_BLOCKED_ERROR_NAME);

    // Inside a credential factory: the connect is permitted (it then fails on the real dial,
    // not on the floor). We assert the factory ran our provider inside the frame by checking
    // the connect does NOT throw EgressBlockedError synchronously.
    const provider = awsCredential(async () => {
      // Simulate the SDK reaching IMDS from inside the frame. The connect is permitted; the
      // request fails for a network reason (no IMDS in CI), which is NOT an EgressBlockedError.
      const err = await new Promise<Error>((resolve) => {
        const req = http.get({ host: '169.254.169.254', port: 1, timeout: 40 }, (res) => {
          res.resume();
          res.on('end', () => resolve(new Error('ok')));
        });
        req.on('timeout', () => {
          req.destroy();
          resolve(new Error('timeout'));
        });
        req.on('error', (e) => resolve(e));
      });
      return err;
    });
    const result = await provider();
    expect(result.name).not.toBe(EGRESS_BLOCKED_ERROR_NAME);
  });

  it('allows the configured loopback IDENTITY_ENDPOINT only through azureCredential()', async () => {
    const server = http.createServer((_req, res) => res.end('azure-token'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}/msi/token`;
    const previous = process.env.IDENTITY_ENDPOINT;
    process.env.IDENTITY_ENDPOINT = endpoint;
    try {
      const install = await installEgressFloor(undefined, () => {});
      teardown = install.uninstall;

      await expect(fetch(endpoint)).rejects.toMatchObject({
        cause: { name: EGRESS_BLOCKED_ERROR_NAME },
      });
      await expect(awsCredential(() => fetch(endpoint))()).rejects.toMatchObject({
        cause: { name: EGRESS_BLOCKED_ERROR_NAME },
      });
      await expect(gcpCredential(() => fetch(endpoint))()).rejects.toMatchObject({
        cause: { name: EGRESS_BLOCKED_ERROR_NAME },
      });

      const response = await azureCredential(() => fetch(endpoint))();
      expect(await response.text()).toBe('azure-token');
    } finally {
      if (previous === undefined) delete process.env.IDENTITY_ENDPOINT;
      else process.env.IDENTITY_ENDPOINT = previous;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
