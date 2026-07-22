import http from 'node:http';
import net, { type AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { EgressBlockedError, installNetConnectFloor, resolveEgressPolicy } from './egress.js';

describe('net.connect DNS-result carrier snapshots (SPEC §6.6 rule 5)', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => uninstall?.());

  it('never forwards a resolver-owned entry whose address changes between consumers', async () => {
    let acceptedConnections = 0;
    const server = net.createServer((socket) => {
      acceptedConnections += 1;
      socket.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing TCP address');

    uninstall = installNetConnectFloor(resolveEgressPolicy(undefined, () => {}));
    let addressReads = 0;
    const entry = new Proxy(
      { family: 4 },
      {
        get(target, property, receiver) {
          if (property === 'address') {
            addressReads += 1;
            return addressReads === 1 ? '93.184.216.34' : '127.0.0.1';
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const socket = net.createConnection({
      autoSelectFamily: true,
      host: 'resolver-carrier.test',
      lookup: ((_hostname, options, callback) => {
        expect(options.all).toBe(true);
        callback(null, [entry] as never);
      }) as net.TcpNetConnectOpts['lookup'],
      port: address.port,
    });
    const outcome = await new Promise<'connected' | Error>((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('error', resolve);
    });

    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(outcome).toBeInstanceOf(EgressBlockedError);
    expect(addressReads).toBe(0);
    expect(acceptedConnections).toBe(0);
  });

  it('preserves all:true callback semantics with fresh dense scalar snapshots', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing TCP address');

    uninstall = installNetConnectFloor(
      resolveEgressPolicy({ allowInternal: [`127.0.0.1:${address.port}`] }, () => {}),
    );
    const resolverEntries = [{ address: '127.0.0.1', family: 4 }];
    const socket = net.createConnection({
      autoSelectFamily: true,
      host: 'all-result.test',
      lookup: ((_hostname, options, callback) => {
        expect(options.all).toBe(true);
        callback(null, resolverEntries);
      }) as net.TcpNetConnectOpts['lookup'],
      port: address.port,
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('preserves scalar callback semantics and the exact numeric address family', async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing TCP address');

    uninstall = installNetConnectFloor(
      resolveEgressPolicy({ allowInternal: [`127.0.0.1:${address.port}`] }, () => {}),
    );
    const socket = net.createConnection({
      family: 4,
      host: 'scalar-result.test',
      lookup: ((_hostname, options, callback) => {
        expect(options.all).not.toBe(true);
        callback(null, '127.0.0.1', 4);
      }) as net.TcpNetConnectOpts['lookup'],
      port: address.port,
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    ['a sparse array', () => new Array(1)],
    [
      'an accessor entry',
      () => [
        Object.defineProperty({ family: 4 }, 'address', { enumerable: true, get: () => '8.8.8.8' }),
      ],
    ],
    [
      'an over-budget array',
      () => Array.from({ length: 257 }, () => ({ address: '8.8.8.8', family: 4 })),
    ],
  ])('fails closed for %s returned by a custom resolver', async (_label, result) => {
    uninstall = installNetConnectFloor(resolveEgressPolicy(undefined, () => {}));
    const socket = net.createConnection({
      autoSelectFamily: true,
      host: 'invalid-result.test',
      lookup: ((_hostname, _options, callback) =>
        callback(null, result() as never)) as net.TcpNetConnectOpts['lookup'],
      port: 80,
    });
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
    socket.destroy();
    expect(error).toBeInstanceOf(EgressBlockedError);
  });
});

describe('http.Agent request carrier snapshots (SPEC §6.6 rule 5)', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => uninstall?.());

  it('does not let a double-read Proxy redirect native Agent reuse after classification', async () => {
    const harness = await prewarmedAgent();
    try {
      uninstall = installNetConnectFloor(resolveEgressPolicy(undefined, () => {}));
      let hostReads = 0;
      const options = new Proxy(
        { host: '93.184.216.34', port: harness.port },
        {
          get(target, property, receiver) {
            if (property === 'host') {
              hostReads += 1;
              return hostReads <= 2 ? '93.184.216.34' : harness.hostname;
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );

      const attached = await addRequestAndCaptureSocket(harness.agent, options);
      expect(attached).not.toBe(harness.pooledSocket);
      expect(hostReads).toBe(0);
      attached.destroy();
      expect(harness.requests()).toBe(1);
    } finally {
      harness.close();
    }
  });

  it('preserves ordinary own-data options and reuses an allowed matching socket', async () => {
    const harness = await prewarmedAgent();
    try {
      uninstall = installNetConnectFloor(
        resolveEgressPolicy({ allowInternal: [`127.0.0.1:${harness.port}`] }, () => {}),
      );
      const attached = await addRequestAndCaptureSocket(harness.agent, {
        host: harness.hostname,
        port: harness.port,
      });
      expect(attached).toBe(harness.pooledSocket);
    } finally {
      harness.close();
    }
  });

  it('classifies native Agent host semantics instead of a conflicting hostname alias', async () => {
    const harness = await prewarmedAgent();
    try {
      uninstall = installNetConnectFloor(
        resolveEgressPolicy({ allowInternal: [`allowed-alias.test:${harness.port}`] }, () => {}),
      );
      await expect(
        addRequestAndCaptureSocket(harness.agent, {
          host: harness.hostname,
          hostname: 'allowed-alias.test',
          port: harness.port,
        }),
      ).rejects.toBeInstanceOf(EgressBlockedError);
      expect(harness.requests()).toBe(1);
    } finally {
      harness.close();
    }
  });

  it('classifies the agent-options overlay that native Agent applies before reuse', async () => {
    const harness = await prewarmedAgent();
    try {
      Object.assign(harness.agent.options, {
        host: harness.hostname,
        port: harness.port,
      });
      uninstall = installNetConnectFloor(resolveEgressPolicy(undefined, () => {}));
      await expect(
        addRequestAndCaptureSocket(harness.agent, {
          host: '93.184.216.34',
          port: harness.port,
        }),
      ).rejects.toBeInstanceOf(EgressBlockedError);
      expect(harness.requests()).toBe(1);
    } finally {
      harness.close();
    }
  });

  it('fails closed without invoking accessors or accepting unstable descriptors', () => {
    uninstall = installNetConnectFloor(resolveEgressPolicy(undefined, () => {}));
    const agent = new http.Agent();
    let getterCalls = 0;
    const accessor = { port: 80 } as Record<string, unknown>;
    Object.defineProperty(accessor, 'host', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return '93.184.216.34';
      },
    });
    expect(() => agent.addRequest(fakeRequest(), accessor)).toThrow(EgressBlockedError);
    expect(getterCalls).toBe(0);

    let descriptorReads = 0;
    const unstable = new Proxy(
      { host: '93.184.216.34', port: 80 },
      {
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (property !== 'host' || descriptor === undefined) return descriptor;
          descriptorReads += 1;
          return { ...descriptor, value: descriptorReads === 1 ? '93.184.216.34' : '127.0.0.1' };
        },
      },
    );
    expect(() => agent.addRequest(fakeRequest(), unstable)).toThrow(EgressBlockedError);
    agent.destroy();
  });

  it('bounds the native Agent request carrier before enumerating values', () => {
    uninstall = installNetConnectFloor(resolveEgressPolicy(undefined, () => {}));
    const agent = new http.Agent();
    const oversized = Object.fromEntries(
      Array.from({ length: 129 }, (_value, index) => [`option${index}`, index]),
    );
    expect(() => agent.addRequest(fakeRequest(), oversized)).toThrow(EgressBlockedError);
    agent.destroy();
  });
});

async function prewarmedAgent(): Promise<{
  agent: http.Agent;
  close: () => void;
  hostname: string;
  pooledSocket: net.Socket;
  port: number;
  requests: () => number;
}> {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.end('ok');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const hostname = 'private-pool.test';
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const lookup: http.RequestOptions['lookup'] = (_hostname, options, callback) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      error: Error | null,
      value: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    if (typeof options !== 'function' && options.all) {
      cb(null, [{ address: '127.0.0.1', family: 4 }]);
      return;
    }
    cb(null, '127.0.0.1', 4);
  };
  await new Promise<void>((resolve, reject) => {
    const request = http.get({ agent, host: hostname, lookup, port }, (response) => {
      response.resume();
      response.once('end', resolve);
    });
    request.once('error', reject);
  });
  const poolName = agent.getName({ host: hostname, port });
  const pooledSocket = agent.freeSockets[poolName]?.[0];
  if (pooledSocket === undefined) throw new Error('missing prewarmed socket');
  return {
    agent,
    close() {
      agent.destroy();
      server.close();
    },
    hostname,
    pooledSocket,
    port,
    requests: () => requests,
  };
}

function fakeRequest(): http.ClientRequest {
  return {
    _last: false,
    emit: () => false,
    getHeader: () => undefined,
    onSocket: () => undefined,
    shouldKeepAlive: true,
  } as unknown as http.ClientRequest;
}

function addRequestAndCaptureSocket(
  agent: http.Agent,
  options: Record<string, unknown>,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const request = {
      _last: false,
      emit: (_event: string, error: Error) => {
        reject(error);
        return true;
      },
      getHeader: () => undefined,
      onSocket: (socket: net.Socket | null, error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        if (socket === null) {
          reject(new Error('Agent returned no socket'));
          return;
        }
        socket.once('error', () => undefined);
        resolve(socket);
      },
      shouldKeepAlive: true,
    } as unknown as http.ClientRequest;
    try {
      agent.addRequest(request, options);
    } catch (error) {
      reject(error);
    }
  });
}
