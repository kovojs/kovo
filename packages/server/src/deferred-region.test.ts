import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/browser';

import { Defer, createDeferredRegionChunkCollector } from './deferred-region.js';
import { renderHtmlValue } from './html.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { jsx } from './jsx-runtime.js';

const html = async (value: unknown): Promise<string> => renderHtmlValue(await value);

describe('Defer JSX primitive', () => {
  it('renders a real kovo-defer placeholder and streams rendered JSX chunks in route context', async () => {
    const collector = createDeferredRegionChunkCollector();

    const placeholder = await html(
      runWithJsxRequestContext(
        {},
        { deferredRegions: collector },
        () =>
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
      '<kovo-defer target="reviews:p1" state="pending" data-kovo-region-priority="after-paint"><section aria-busy>Loading &lt;reviews&gt;</section></kovo-defer>',
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
      runWithJsxRequestContext(
        {},
        { deferredRegions: collector },
        () =>
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
  });

  it('passes rendered JSX HTML through without double escaping in deferred chunks', async () => {
    const collector = createDeferredRegionChunkCollector();

    await html(
      runWithJsxRequestContext(
        {},
        { deferredRegions: collector },
        () =>
          Defer({
            priority: 'after-paint',
            render: () => jsx('strong', { children: 'Ready' }),
            target: 'answers',
          }),
      ),
    );

    expect((await collector.chunks())[0]?.fragments[0]?.html).toBe('<strong>Ready</strong>');
  });

  it('renders critical and out-of-context regions immediately without chunks', async () => {
    const collector = createDeferredRegionChunkCollector();

    await expect(
      html(
        runWithJsxRequestContext(
          {},
          { deferredRegions: collector },
          () =>
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
