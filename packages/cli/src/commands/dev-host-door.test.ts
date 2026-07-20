import { createServer } from 'node:http';

import type { ViteDevServer } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import {
  installKovoDevHostDoor,
  installKovoDevSourceFallbackDoor,
  type KovoDevNodeIngressProfile,
} from './dev-host-door.js';

type DevMiddleware = (
  request: Parameters<KovoDevNodeIngressProfile['rejectNodeRequestPreloadIngress']>[0],
  response: Parameters<KovoDevNodeIngressProfile['rejectNodeRequestPreloadIngress']>[1],
  next: () => void,
) => void;

describe('kovo dev host door ingress ordering', () => {
  // @kovo-security-classifier-corpus dev-host-pre-url-ingress
  // @kovo-security-certifies C13 dev-host-pre-url-ingress-closed
  it('runs complete ingress admission before URL parsing or downstream dev callbacks', async () => {
    const httpServer = createServer();
    let originalUpgradeCalls = 0;
    httpServer.on('upgrade', () => {
      originalUpgradeCalls += 1;
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('Missing test listener.');
    const expectedOrigin = `http://127.0.0.1:${address.port}`;

    const middleware: DevMiddleware[] = [];
    const server = {
      config: {
        server: { host: '127.0.0.1' },
        webSocketToken: '0123456789abcdef',
      },
      httpServer,
      middlewares: {
        use(handler: DevMiddleware) {
          middleware.push(handler);
        },
      },
    } as unknown as ViteDevServer;
    let httpIngressCalls = 0;
    let websocketIngressCalls = 0;
    const nodeIngress: KovoDevNodeIngressProfile = {
      nodeRequestPreloadIngressRejection() {
        websocketIngressCalls += 1;
        return { message: 'URI Too Long', status: 414 };
      },
      rejectNodeRequestPreloadIngress() {
        httpIngressCalls += 1;
        return true;
      },
    };

    try {
      installKovoDevHostDoor(server, nodeIngress);
      installKovoDevSourceFallbackDoor(server, nodeIngress);
      expect(middleware).toHaveLength(2);

      let urlReads = 0;
      const request = Object.defineProperty(
        {
          headers: { host: `127.0.0.1:${address.port}`, origin: expectedOrigin },
          method: 'GET',
          rawHeaders: [
            'Host',
            `127.0.0.1:${address.port}`,
            'Host',
            `127.0.0.1:${address.port}`,
            'Origin',
            expectedOrigin,
          ],
        },
        'url',
        {
          get() {
            urlReads += 1;
            throw new Error('The dev-host door parsed a URL before ingress admission.');
          },
        },
      ) as Parameters<DevMiddleware>[0];
      const response = {} as Parameters<DevMiddleware>[1];
      let nextCalls = 0;

      middleware[0]!(request, response, () => {
        nextCalls += 1;
      });
      middleware[1]!(request, response, () => {
        nextCalls += 1;
      });

      let socketResponse = '';
      httpServer.emit(
        'upgrade',
        request,
        {
          end(value: string) {
            socketResponse = value;
          },
        },
        Buffer.alloc(0),
      );

      expect(httpIngressCalls).toBe(2);
      expect(websocketIngressCalls).toBe(1);
      expect(urlReads).toBe(0);
      expect(nextCalls).toBe(0);
      expect(originalUpgradeCalls).toBe(0);
      expect(socketResponse).toContain('HTTP/1.1 414 URI Too Long');
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});
