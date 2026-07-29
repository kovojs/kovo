import { afterEach, describe, expect, it } from 'vitest';

import { Devtool$init } from './client/devtool-pz.client.js';
import {
  applyRuntimeFrame,
  DevtoolRuntime$init,
  renderRecentRuntimeFrames,
} from './client/devtool-runtime.client.js';
import { renderPage } from './render.mjs';

const runtimeFrame = {
  app: 'demo',
  changes: [{ domain: 'orders', keyCount: 1 }],
  mutation: 'orders/refresh',
  phase: 'settled',
  queries: [
    {
      bytes: 37,
      delta: false,
      keyed: true,
      name: 'orderHistory',
      settlesPendingWork: true,
      value: 'redacted',
    },
  ],
  schema: 'kovo-devtool-runtime-frame/v1',
  sequence: 2,
  status: 200,
  targets: { count: 1, queryNames: ['orderHistory'], truncated: false },
  truncated: false,
} as const;

function renderedDevtool() {
  return renderPage({
    app: 'demo',
    bundle: {
      app: 'demo',
      blurb: 'Browser fixture',
      counts: { component: 1, domain: 1, mutation: 1, query: 1 },
      edges: [
        {
          data: {},
          from: 'mutation:orders/refresh',
          id: 'mutation:orders/refresh->domain:orders:writes',
          kind: 'writes',
          to: 'domain:orders',
        },
        {
          data: {},
          from: 'domain:orders',
          id: 'domain:orders->query:orderHistory:backs',
          kind: 'backs',
          to: 'query:orderHistory',
        },
        {
          data: {},
          from: 'query:orderHistory',
          id: 'query:orderHistory->component:order-list:feeds',
          kind: 'feeds',
          to: 'component:order-list',
        },
        {
          data: {},
          from: 'component:order-list',
          id: 'component:order-list->mutation:orders/refresh:emits',
          kind: 'emits',
          to: 'mutation:orders/refresh',
        },
      ],
      label: 'Demo',
      limitations: [],
      nodes: [
        {
          data: {
            guards: [],
            inputFields: [],
            optimistic: [],
            writes: ['orders'],
          },
          id: 'mutation:orders/refresh',
          kind: 'mutation',
          label: 'Refresh orders',
          name: 'orders/refresh',
          source: null,
        },
        {
          data: { guards: [] },
          id: 'domain:orders',
          kind: 'domain',
          label: 'Orders',
          name: 'orders',
          source: null,
        },
        {
          data: { domains: ['orders'], guards: [] },
          id: 'query:orderHistory',
          kind: 'query',
          label: 'Order history',
          name: 'orderHistory',
          source: null,
        },
        {
          data: {
            domName: 'order-list',
            fragments: ['orders'],
            guards: [],
            mutationForms: [{ fields: [], mutation: 'orders/refresh' }],
            queries: ['orderHistory'],
          },
          id: 'component:order-list',
          kind: 'component',
          label: 'OrderList',
          name: 'order-list',
          source: null,
        },
      ],
      provenance: 'browser fixture',
      view: 'source-graph',
    },
    manifest: [{ blurb: 'Browser fixture', id: 'demo', label: 'Demo' }],
    pzHref: '/c/devtool-pz.js',
    runtime: {
      frames: [runtimeFrame],
      href: '/_runtime/frames',
      moduleHref: '/c/devtool-runtime.js',
    },
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('devtool browser render and interaction', () => {
  it('keeps server-rendered navigation usable while pan/zoom and hover progressively enhance it', () => {
    document.body.innerHTML = renderedDevtool();
    const component = document.querySelector<HTMLAnchorElement>(
      '[data-node-id="component:order-list"]',
    );
    const canvas = document.querySelector<HTMLElement>('[data-pz-root]');
    const canvasWrap = document.querySelector<HTMLElement>('.canvas-wrap');
    const graph = document.querySelector<HTMLElement>('[data-pz]');
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-zoom="in"]');
    if (!component || !canvas || !canvasWrap || !graph || !zoomIn) {
      throw new Error('missing devtool fixture');
    }

    expect(component.href).toContain('sel=component%3Aorder-list');
    expect(document.querySelector('[data-runtime-list]')?.textContent).toContain('values redacted');
    expect(document.querySelector('[data-runtime-status]')?.textContent).toBe('snapshot');
    expect(component.classList.contains('runtime-hot')).toBe(false);
    expect(
      document
        .querySelector('[data-node-id="mutation:orders/refresh"]')
        ?.classList.contains('runtime-hot'),
    ).toBe(true);

    const abort = new AbortController();
    Devtool$init(undefined, { signal: abort.signal });
    const initialTransform = graph.style.transform;
    component.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(component.classList.contains('hov')).toBe(true);
    expect(document.querySelectorAll('path.hov').length).toBeGreaterThan(0);

    zoomIn.click();
    expect(graph.style.transform).not.toBe(initialTransform);
    canvasWrap.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0' }));
    expect(canvasWrap.tabIndex).toBeGreaterThanOrEqual(0);
    abort.abort();
  });

  it('replays safe phase facts, lights static edges, and cleans up its EventSource', () => {
    document.body.innerHTML = renderedDevtool();
    const instances: FakeEventSource[] = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: class extends FakeEventSource {
        constructor(href: string) {
          super(href);
          instances.push(this);
        }
      },
    });
    try {
      const abort = new AbortController();
      DevtoolRuntime$init(undefined, { signal: abort.signal });
      expect(instances).toHaveLength(1);
      instances[0].emit('frame', {
        data: JSON.stringify({
          ...runtimeFrame,
          changes: [],
          phase: 'pending',
          queries: [],
          sequence: 1,
          status: undefined,
        }),
      });
      expect(
        document
          .querySelector('[data-node-id="mutation:orders/refresh"]')
          ?.classList.contains('runtime-pending'),
      ).toBe(true);
      instances[0].emit('frame', { data: JSON.stringify(runtimeFrame) });

      expect(document.querySelector('[data-runtime-status]')?.textContent).toBe('live');
      expect(
        document
          .querySelector('[data-node-id="query:orderHistory"]')
          ?.classList.contains('runtime-hot'),
      ).toBe(true);
      expect(
        document
          .querySelector('[data-node-id="mutation:orders/refresh"]')
          ?.classList.contains('runtime-pending'),
      ).toBe(false);
      expect(document.querySelectorAll('path.runtime-hot').length).toBeGreaterThan(0);
      expect(
        document
          .querySelector(
            'path[data-from="component:order-list"][data-to="mutation:orders/refresh"]',
          )
          ?.classList.contains('runtime-hot'),
      ).toBe(false);
      expect(
        document
          .querySelector('path[data-from="mutation:orders/refresh"][data-to="domain:orders"]')
          ?.classList.contains('runtime-hot'),
      ).toBe(true);
      expect(document.querySelector('[data-runtime-list]')?.textContent).toContain(
        '37 B values redacted',
      );

      abort.abort();
      expect(instances[0].closed).toBe(true);
      expect([...instances[0].listeners.values()].every((listeners) => listeners.size === 0)).toBe(
        true,
      );
      expect(document.querySelector('[data-runtime-status]')?.textContent).toBe('closed');
    } finally {
      if (original === undefined) delete (globalThis as { EventSource?: unknown }).EventSource;
      else Object.defineProperty(globalThis, 'EventSource', original);
    }
  });

  it('rejects hostile frame shapes and renders summaries only through text nodes', () => {
    document.body.innerHTML = renderedDevtool();
    const root = document.querySelector<HTMLElement>('[data-runtime-panel]');
    const app = document.querySelector<HTMLElement>('.app');
    if (!root || !app) throw new Error('missing runtime fixture');

    const hostile = {
      ...runtimeFrame,
      mutation: '<img src=x onerror=alert(1)>',
    };
    expect(applyRuntimeFrame(app, hostile)).toBe(false);
    renderRecentRuntimeFrames(root, [hostile]);
    expect(
      applyRuntimeFrame(app, {
        ...runtimeFrame,
        queries: [{ ...runtimeFrame.queries[0], delta: 'false' }],
      }),
    ).toBe(false);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[data-runtime-list]')?.textContent).not.toContain('onerror');
  });
});

class FakeEventSource {
  readonly href: string;
  readonly listeners = new Map<string, Set<(event: { data?: string }) => void>>();
  closed = false;

  constructor(href: string) {
    this.href = href;
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, event: { data?: string }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.get(type)?.delete(listener);
  }
}
