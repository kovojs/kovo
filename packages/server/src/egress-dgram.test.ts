import dgram from 'node:dgram';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EGRESS_BLOCKED_ERROR_NAME } from './egress.js';
import { activeEgressFloor, installEgressFloorSync, selfProbe } from './egress-bootstrap.js';

function closeSocket(socket: dgram.Socket): void {
  try {
    socket.close();
  } catch {
    // An unconnected send is rejected before Node auto-binds the socket.
  }
}

async function bindLoopbackServer(): Promise<{ port: number; server: dgram.Socket }> {
  const server = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, server };
}

describe('node:dgram outbound-egress floor (SPEC §6.6)', () => {
  afterEach(() => {
    activeEgressFloor()?.uninstall();
    vi.restoreAllMocks();
  });

  it('default-denies unconnected datagrams before a socket-owned lookup can rewrite the peer', async () => {
    const { port, server } = await bindLoopbackServer();
    const client = dgram.createSocket({
      type: 'udp4',
      lookup(hostname, _options, callback) {
        callback(null, hostname === '8.8.8.8' ? '127.0.0.1' : hostname, 4);
      },
    });
    const received = vi.fn();
    server.on('message', received);
    try {
      installEgressFloorSync({ allowInternal: [] }, () => {});
      expect(() => client.send(Buffer.from('bypass'), port, '8.8.8.8')).toThrowError(
        expect.objectContaining({
          name: EGRESS_BLOCKED_ERROR_NAME,
          reason: 'unconnected-datagram',
        }),
      );
      expect(received).not.toHaveBeenCalled();
    } finally {
      closeSocket(client);
      closeSocket(server);
    }
  });

  it('blocks a denied peer on every send even when the UDP socket predates the floor', async () => {
    const { port, server } = await bindLoopbackServer();
    const client = dgram.createSocket('udp4');
    const received = vi.fn();
    server.on('message', received);
    try {
      client.connect(port, '127.0.0.1');
      await once(client, 'connect');
      installEgressFloorSync({ allowInternal: [] }, () => {});
      expect(() => client.send(Buffer.from('preconnected-bypass'))).toThrowError(
        expect.objectContaining({ name: EGRESS_BLOCKED_ERROR_NAME }),
      );
      expect(received).not.toHaveBeenCalled();
    } finally {
      closeSocket(client);
      closeSocket(server);
    }
  });

  it('allows a connected datagram only when its pinned peer is explicitly internal-allowlisted', async () => {
    const { port, server } = await bindLoopbackServer();
    const client = dgram.createSocket('udp4');
    try {
      installEgressFloorSync({ allowInternal: [`127.0.0.1:${port}`] }, () => {});
      client.connect(port, '127.0.0.1');
      await once(client, 'connect');
      const received = once(server, 'message');
      await new Promise<void>((resolve, reject) => {
        client.send(Buffer.from('allowed'), (error) =>
          error === null ? resolve() : reject(error),
        );
      });
      const [message] = await received;
      expect((message as Buffer).toString('utf8')).toBe('allowed');
    } finally {
      closeSocket(client);
      closeSocket(server);
    }
  });

  it('checks the kernel peer after a custom socket lookup rebinds a public-looking host', async () => {
    const { port, server } = await bindLoopbackServer();
    const client = dgram.createSocket({
      type: 'udp4',
      lookup(hostname, _options, callback) {
        callback(null, hostname === 'public.example.test' ? '127.0.0.1' : hostname, 4);
      },
    });
    const received = vi.fn();
    server.on('message', received);
    try {
      installEgressFloorSync({ allowInternal: [] }, () => {});
      client.connect(port, 'public.example.test');
      await once(client, 'connect');
      expect(() => client.send(Buffer.from('resolver-rebind'))).toThrowError(
        expect.objectContaining({ name: EGRESS_BLOCKED_ERROR_NAME }),
      );
      expect(received).not.toHaveBeenCalled();
    } finally {
      closeSocket(client);
      closeSocket(server);
    }
  });

  it('uses the boot-captured remoteAddress sink witness after late prototype poisoning', async () => {
    const { port, server } = await bindLoopbackServer();
    const client = dgram.createSocket('udp4');
    const originalRemoteAddress = dgram.Socket.prototype.remoteAddress;
    try {
      client.connect(port, '127.0.0.1');
      await once(client, 'connect');
      installEgressFloorSync({ allowInternal: [] }, () => {});
      dgram.Socket.prototype.remoteAddress = () => ({
        address: '8.8.8.8',
        family: 'IPv4',
        port: 53,
        size: 0,
      });
      expect(() => client.send(Buffer.from('poisoned-peer'))).toThrowError(
        expect.objectContaining({ name: EGRESS_BLOCKED_ERROR_NAME }),
      );
    } finally {
      dgram.Socket.prototype.remoteAddress = originalRemoteAddress;
      closeSocket(client);
      closeSocket(server);
    }
  });

  it('self-probes a late datagram transport replacement', () => {
    const warnings: string[] = [];
    installEgressFloorSync({ allowInternal: [] }, (message) => warnings.push(message));
    dgram.Socket.prototype.send =
      function replacedSend(): void {} as typeof dgram.Socket.prototype.send;

    const status = selfProbe((message) => warnings.push(message));
    expect(status.dgramInstalled).toBe(false);
    expect(warnings.join('\n')).toContain('dgram.Socket.prototype.connect/send');
  });
});
