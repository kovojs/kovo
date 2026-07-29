import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { createRuntimeFrameStore } from './runtime-frames.mjs';
import { devtoolMountPlugin } from './vite.mjs';

class FixtureResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = new Map();
    this.statusCode = 200;
  }

  end(chunk) {
    this.chunk = chunk;
    this.emit('finish');
  }

  getHeader(name) {
    return this.headers.get(name.toLowerCase());
  }

  write() {
    return true;
  }
}

describe('devtool Vite mount', () => {
  it('installs development capture before the prefix handler over one shared store', async () => {
    const runtimeFrames = createRuntimeFrameStore();
    const handlers = [];
    const nodeHandler = vi.fn((_request, response) => response.end('devtool'));
    const plugin = devtoolMountPlugin('/__kovo', { handlerModuleId: '/src/devtool.ts' });

    await plugin.configureServer({
      middlewares: { use: (handler) => handlers.push(handler) },
      ssrLoadModule: vi.fn(async () => ({
        manifest: [{ id: 'demo' }],
        nodeHandler,
        runtimeFrames,
      })),
    });

    expect(handlers).toHaveLength(2);
    const response = new FixtureResponse();
    handlers[0](
      { headers: { 'kovo-targets': 'orders=orderHistory' }, url: '/_m/orders' },
      response,
      () => {
        response.end('<kovo-query name="orderHistory">{"private":true}</kovo-query>');
      },
    );
    expect(runtimeFrames.recent()).toMatchObject([
      { app: 'demo', phase: 'pending' },
      { app: 'demo', phase: 'settled', queries: [{ name: 'orderHistory' }] },
    ]);

    const mounted = new FixtureResponse();
    handlers[1]({ url: '/__kovo/?app=demo' }, mounted, vi.fn());
    expect(nodeHandler).toHaveBeenCalled();
    expect(mounted.chunk).toBe('devtool');
  });

  it('has no production/static build hook and can disable capture explicitly', async () => {
    const handlers = [];
    const plugin = devtoolMountPlugin('/__kovo', {
      captureRuntimeFrames: false,
      handlerModuleId: '/src/devtool.ts',
    });
    expect(Object.keys(plugin).sort()).toEqual(['configureServer', 'name']);

    await plugin.configureServer({
      middlewares: { use: (handler) => handlers.push(handler) },
      ssrLoadModule: vi.fn(async () => ({
        manifest: [{ id: 'demo' }],
        nodeHandler: vi.fn(),
        runtimeFrames: createRuntimeFrameStore(),
      })),
    });
    expect(handlers).toHaveLength(1);
  });
});
