import { afterEach, describe, expect, it, vi } from 'vitest';

import { trustedHtml } from '@kovojs/browser';

import { Defer, createDeferredRegionChunkCollector } from './deferred-region.js';
import { renderHtmlValue } from './html.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { jsx } from './jsx-runtime.js';

const html = async (value: unknown): Promise<string> => renderHtmlValue(await value);

afterEach(() => {
  vi.useRealTimers();
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
          fallback: ['Loading ', '<b>raw</b>', trustedHtml('<i>trusted</i>')],
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
          render: () => trustedHtml('<strong>trusted region</strong>'),
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

    await expect(
      html(
        runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
          Defer({
            fallback: jsx('section', { children: 'Loading reviews' }),
            priority: 'after-paint',
            render: () => {
              throw new Error('review backend unavailable');
            },
            target: 'reviews',
          }),
        ),
      ),
    ).resolves.toContain('state="pending"');

    await expect(collector.chunks()).resolves.toEqual([
      {
        fragments: [
          {
            html: '<kovo-defer target="reviews" state="error" data-kovo-region-priority="after-paint"><section>Loading reviews</section></kovo-defer>',
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

    await html(
      runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
        Defer({
          fallback: 'Still loading',
          priority: 'visible',
          render: () => new Promise<never>(() => {}),
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
            html: '<kovo-defer target="slow-rail" state="error" data-kovo-region-priority="visible">Still loading</kovo-defer>',
            priority: 'visible',
            target: 'slow-rail',
          },
        ],
        priority: 'visible',
      },
    ]);
  });

  it('renders critical and out-of-context regions immediately without chunks', async () => {
    const collector = createDeferredRegionChunkCollector();

    await expect(
      html(
        runWithJsxRequestContext({}, { deferredRegions: collector }, () =>
          Defer({
            render: () => jsx('main', { children: 'Critical' }),
            target: 'critical',
          }),
        ),
      ),
    ).resolves.toBe('<main>Critical</main>');
    await expect(collector.chunks()).resolves.toEqual([]);

    await expect(
      html(
        Defer({
          priority: 'after-paint',
          render: () => jsx('main', { children: 'No collector' }),
          target: 'no-context',
        }),
      ),
    ).resolves.toBe('<main>No collector</main>');
  });
});
