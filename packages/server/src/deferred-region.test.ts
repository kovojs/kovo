import { afterEach, describe, expect, it, vi } from 'vitest';

import { trustedHtml } from '@kovojs/browser';

import {
  createFrameworkAsyncContextCell,
  currentFrameworkAsyncContextValue,
  runWithFrameworkAsyncContext,
} from './async-context.js';
import { Defer, createDeferredRegionChunkCollector } from './deferred-region.js';
import { renderHtmlValue } from './html.js';
import { currentJsxRequestContext, runWithJsxRequestContext } from './jsx-context.js';
import { jsx } from './jsx-runtime.js';

const html = async (value: unknown): Promise<string> => renderHtmlValue(await value);
const nativePromiseAll = Promise.all;
const nativePromiseResolve = Promise.resolve;
const nativePromiseThen = Promise.prototype.then;

afterEach(() => {
  vi.useRealTimers();
  Promise.all = nativePromiseAll;
  Promise.resolve = nativePromiseResolve;
  Promise.prototype.then = nativePromiseThen;
});

describe('Defer JSX primitive', () => {
  it('renders a real kovo-defer placeholder and streams rendered JSX chunks in route context', async () => {
    const collector = createDeferredRegionChunkCollector();

    const placeholder = await html(
      runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
        Defer({
          fallback: jsx('section', {
            'aria-busy': true,
            children: 'Loading <reviews>',
          }),
          priority: 'after-paint',
          render: () => jsx('section', { children: 'Ready <reviews>' }),
          stylesheets: ['/reviews.css'],
          target: 'reviews:p1',
        }),
      ),
    );

    expect(placeholder).toBe(
      '<kovo-defer target="reviews:p1" state="pending" data-kovo-region-priority="after-paint"><section aria-busy="true">Loading &lt;reviews&gt;</section></kovo-defer>',
    );
    expect(await collector.chunks()).toEqual([
      {
        fragments: [
          {
            html: '<section>Ready &lt;reviews&gt;</section>',
            priority: 'normal',
            stylesheets: ['/reviews.css'],
            target: 'reviews:p1',
          },
        ],
        priority: 'normal',
      },
    ]);
  });

  it('escapes fallback and bare-string render output unless trusted HTML is explicit', async () => {
    const collector = createDeferredRegionChunkCollector();

    const placeholder = await html(
      runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
        Defer({
          fallback: ['Loading ', '<b>raw</b>', trustedHtml('<i>trusted</i>', { reason: "framework server rendering test fixture" })],
          priority: 'visible',
          render: () => '<strong>raw region</strong>',
          target: 'rail&details',
        }),
      ),
    );

    expect(placeholder).toBe(
      '<kovo-defer target="rail&amp;details" state="pending" data-kovo-region-priority="visible">Loading &lt;b&gt;raw&lt;/b&gt;<i>trusted</i></kovo-defer>',
    );
    expect(await collector.chunks()).toEqual([
      {
        fragments: [
          {
            html: '&lt;strong&gt;raw region&lt;/strong&gt;',
            priority: 'visible',
            target: 'rail&details',
          },
        ],
        priority: 'visible',
      },
    ]);

    const trustedCollector = createDeferredRegionChunkCollector();
    await html(
      runWithJsxRequestContext({}, { deferredRegions: trustedCollector }, () =>
        Defer({
          priority: 'visible',
          render: () => trustedHtml('<strong>trusted region</strong>', { reason: "framework server rendering test fixture" }),
          target: 'trusted-region',
        }),
      ),
    );
    expect(await trustedCollector.chunks()).toEqual([
      {
        fragments: [
          {
            html: '<strong>trusted region</strong>',
            priority: 'visible',
            target: 'trusted-region',
          },
        ],
        priority: 'visible',
      },
    ]);
  });

  it('passes rendered JSX HTML through without double escaping in deferred chunks', async () => {
    const collector = createDeferredRegionChunkCollector();

    await html(
      runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
        Defer({
          priority: 'after-paint',
          render: () => jsx('strong', { children: 'Ready' }),
          target: 'answers',
        }),
      ),
    );

    expect((await collector.chunks())[0]?.fragments[0]?.html).toBe('<strong>Ready</strong>');
  });

  it('isolates a throwing deferred region as an error chunk', async () => {
    const collector = createDeferredRegionChunkCollector();
    const request = {};
    let releaseRegion!: () => void;
    const regionGate = new Promise<void>((resolve) => {
      releaseRegion = resolve;
    });
    const FallbackProbe = () =>
      jsx('section', {
        children:
          currentJsxRequestContext() === request ? 'Loading reviews in JSX' : 'Missing JSX context',
      });

    await expect(
      html(
        runWithJsxRequestContext(request, { deferredRegions: collector }, () =>
          Defer({
            fallback: jsx(FallbackProbe, {}),
            priority: 'after-paint',
            render: async () => {
              await regionGate;
              throw new Error('review backend unavailable');
            },
            target: 'reviews',
          }),
        ),
      ),
    ).resolves.toContain('state="pending"');

    releaseRegion();
    await expect(collector.chunks()).resolves.toEqual([
      {
        fragments: [
          {
            html: '<kovo-defer target="reviews" state="error" data-kovo-region-priority="after-paint"><section>Loading reviews in JSX</section></kovo-defer>',
            priority: 'normal',
            target: 'reviews',
          },
        ],
        priority: 'normal',
      },
    ]);
  });

  it('keeps deferred render errors and raw sibling output out of streamed markup', async () => {
    const collector = createDeferredRegionChunkCollector();
    const payload = '<img src=x onerror=alert(1)>';

    const shell = await html(
      runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
        jsx('main', {
          children: [
            Defer({
              fallback: ['Loading ', payload],
              priority: 'after-paint',
              render: () => {
                throw new Error(`private deferred detail ${payload}`);
              },
              target: 'unsafe-region',
            }),
            Defer({
              fallback: 'Loading sibling',
              priority: 'after-paint',
              render: () => '<strong>raw sibling</strong>',
              target: 'safe-sibling',
            }),
          ],
        }),
      ),
    );

    expect(shell).toContain('Loading &lt;img src=x onerror=alert(1)&gt;');
    expect(shell).not.toContain(payload);

    const chunks = await collector.chunks();
    const serialized = JSON.stringify(chunks);

    expect(serialized).not.toContain('private deferred detail');
    expect(serialized).not.toContain(payload);
    expect(chunks).toEqual([
      {
        fragments: [
          {
            html: '<kovo-defer target="unsafe-region" state="error" data-kovo-region-priority="after-paint">Loading &lt;img src=x onerror=alert(1)&gt;</kovo-defer>',
            priority: 'normal',
            target: 'unsafe-region',
          },
        ],
        priority: 'normal',
      },
      {
        fragments: [
          {
            html: '&lt;strong&gt;raw sibling&lt;/strong&gt;',
            priority: 'normal',
            target: 'safe-sibling',
          },
        ],
        priority: 'normal',
      },
    ]);
  });

  it('bounds a hung deferred region with a per-region timeout', async () => {
    vi.useFakeTimers();
    const collector = createDeferredRegionChunkCollector();
    const request = {};
    const FallbackProbe = () =>
      currentJsxRequestContext() === request ? 'Still loading in JSX' : 'Missing JSX context';
    let releaseHungRender!: () => void;
    const hungRenderGate = new Promise<void>((resolve) => {
      releaseHungRender = resolve;
    });
    let finishHungRender!: () => void;
    const hungRenderFinished = new Promise<void>((resolve) => {
      finishHungRender = resolve;
    });
    let lateHungContext: unknown = 'not-run';

    await html(
      runWithJsxRequestContext(request, { deferredRegions: collector }, () =>
        Defer({
          fallback: jsx(FallbackProbe, {}),
          priority: 'visible',
          render: async () => {
            await hungRenderGate;
            lateHungContext = currentJsxRequestContext();
            finishHungRender();
            return jsx('strong', { children: 'Too late' });
          },
          target: 'slow-rail',
          timeoutMs: 5,
        }),
      ),
    );

    const chunks = collector.chunks();
    await vi.advanceTimersByTimeAsync(5);

    await expect(chunks).resolves.toEqual([
      {
        fragments: [
          {
            html: '<kovo-defer target="slow-rail" state="error" data-kovo-region-priority="visible">Still loading in JSX</kovo-defer>',
            priority: 'visible',
            target: 'slow-rail',
          },
        ],
        priority: 'visible',
      },
    ]);
    releaseHungRender();
    await hungRenderFinished;
    expect(lateHungContext).toBeUndefined();
  });

  it('does not re-enter JSX when a timed-out render rejects late', async () => {
    vi.useFakeTimers();
    const collector = createDeferredRegionChunkCollector();
    const request = {};
    const fallbackContexts: unknown[] = [];
    const fallbackProbe = {
      then(onFulfilled: (value: string) => unknown) {
        fallbackContexts.push(currentJsxRequestContext());
        return Promise.resolve(onFulfilled('Still loading'));
      },
    } as unknown as Promise<string>;
    let rejectLateRender!: (error: Error) => void;
    const lateRender = new Promise<never>((_resolve, reject) => {
      rejectLateRender = reject;
    });

    await html(
      runWithJsxRequestContext(request, { deferredRegions: collector }, () =>
        Defer({
          fallback: fallbackProbe,
          priority: 'after-paint',
          render: () => lateRender,
          target: 'late-rejection',
          timeoutMs: 5,
        }),
      ),
    );

    const chunks = collector.chunks();
    await vi.advanceTimersByTimeAsync(5);
    await expect(chunks).resolves.toHaveLength(1);
    expect(fallbackContexts).toEqual([request, request]);

    rejectLateRender(new Error('late private failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(fallbackContexts).toEqual([request, request]);
  });

  it('keeps the live collector when a settled deferred render discovers a nested Defer', async () => {
    const collector = createDeferredRegionChunkCollector();
    let releaseOuter!: () => void;
    const outerGate = new Promise<void>((resolve) => {
      releaseOuter = resolve;
    });

    const shell = await html(
      runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
        Defer({
          fallback: 'Loading outer',
          priority: 'after-paint',
          render: async () => {
            await outerGate;
            return jsx('section', {
              children: Defer({
                fallback: 'Loading inner',
                priority: 'after-paint',
                render: () => jsx('strong', { children: 'Nested ready' }),
                target: 'nested-inner',
              }),
            });
          },
          target: 'nested-outer',
        }),
      ),
    );
    expect(shell).toContain('target="nested-outer"');

    releaseOuter();
    const chunks = await collector.chunks();
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.fragments[0]?.html).toContain('target="nested-inner"');
    expect(chunks[1]?.fragments[0]?.html).toBe('<strong>Nested ready</strong>');
  });

  it('renders critical and out-of-context regions immediately without chunks', async () => {
    const collector = createDeferredRegionChunkCollector();
    const sibling = createFrameworkAsyncContextCell<string>('oracle.defer-immediate-sibling');
    const observed: (string | undefined)[] = [];

    await expect(
      html(
        runWithFrameworkAsyncContext(sibling, 'request-owned', () =>
          runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
            Defer({
              render: () => {
                observed.push(currentFrameworkAsyncContextValue(sibling));
                return jsx('main', { children: 'Critical' });
              },
              target: 'critical',
            }),
          ),
        ),
      ),
    ).resolves.toBe('<main>Critical</main>');
    await expect(collector.chunks()).resolves.toEqual([]);

    await expect(
      html(
        runWithFrameworkAsyncContext(sibling, 'request-owned', () =>
          runWithJsxRequestContext({}, {}, () =>
            Defer({
              priority: 'after-paint',
              render: () => {
                observed.push(currentFrameworkAsyncContextValue(sibling));
                return jsx('main', { children: 'No collector' });
              },
              target: 'no-context',
            }),
          ),
        ),
      ),
    ).resolves.toBe('<main>No collector</main>');
    expect(observed).toEqual(['request-owned', 'request-owned']);
  });

  it('does not dispatch late Promise combinator replacements for deferred output authority', async () => {
    const collector = createDeferredRegionChunkCollector();
    const poisonHits = { all: 0, resolve: 0, then: 0 };
    Promise.resolve = function poisonedResolve(value?: unknown) {
      poisonHits.resolve += 1;
      return Reflect.apply(nativePromiseResolve, Promise, [value]);
    } as typeof Promise.resolve;
    Promise.prototype.then = function poisonedThen(onFulfilled, onRejected) {
      poisonHits.then += 1;
      return Reflect.apply(nativePromiseThen, this, [onFulfilled, onRejected]);
    } as typeof Promise.prototype.then;

    const deferred = runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
      Defer({
        fallback: 'Loading',
        priority: 'after-paint',
        render: async () => jsx('strong', { children: 'Committed region' }),
        target: 'promise-authority',
      }),
    );
    Promise.resolve = nativePromiseResolve;
    Promise.prototype.then = nativePromiseThen;
    const placeholder = await html(deferred);

    Promise.all = function poisonedAll(values: Iterable<unknown>) {
      poisonHits.all += 1;
      return Reflect.apply(nativePromiseAll, Promise, [values]);
    } as typeof Promise.all;
    const chunks = collector.chunks();
    Promise.all = nativePromiseAll;

    expect(placeholder).toContain('Loading');
    await expect(chunks).resolves.toEqual([
      {
        fragments: [
          {
            html: '<strong>Committed region</strong>',
            priority: 'normal',
            target: 'promise-authority',
          },
        ],
        priority: 'normal',
      },
    ]);
    expect(poisonHits).toEqual({ all: 0, resolve: 0, then: 0 });
  });
});
