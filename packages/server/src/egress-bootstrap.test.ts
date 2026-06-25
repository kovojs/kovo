import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, setGlobalDispatcher } from 'undici';

import { createApp } from './app.js';
import { EGRESS_BLOCKED_ERROR_NAME, EgressConfigError } from './egress.js';
import { activeEgressFloor, installEgressFloor, selfProbe } from './egress-bootstrap.js';
import { awsCredential } from './egress-credentials.js';

describe('egress bootstrap: dual-layer install + self-probe', () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    activeEgressFloor()?.uninstall();
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

  it('end-to-end: createApp({ egress }) floors fetch to a private literal IP', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;

    createApp({ egress: { allowInternal: [`127.0.0.1:${port}`] } });
    // createApp fires installEgressFloor without awaiting it (it stays synchronous); poll for
    // the async undici layer to settle.
    for (let i = 0; i < 50 && !activeEgressFloor()?.undiciInstalled; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    teardown = activeEgressFloor()?.uninstall;

    // The allowlisted loopback origin is reachable.
    const ok = await fetch(`http://127.0.0.1:${port}/`);
    expect(await ok.text()).toBe('ok');

    // A different, non-allowlisted private literal is denied.
    await expect(fetch('http://10.0.5.2:6379/')).rejects.toBeDefined();

    server.close();
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
});
