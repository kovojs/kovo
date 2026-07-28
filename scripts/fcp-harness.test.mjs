import { describe, expect, it } from 'vitest';

import { htmlAssetInventory, runFcpHarness, summarizeAxeResult } from './fcp-harness.mjs';

describe('fcp harness HTML asset inventory', () => {
  it('classifies deferred stylesheets, noscript fallbacks, modulepreloads, and inline bytes', () => {
    const inventory = htmlAssetInventory(
      [
        '<!doctype html><html><head>',
        '<style data-kovo-critical-href="/assets/app.css">body{color:red}</style>',
        '<link rel="preload" as="style" href="/assets/app.css" data-kovo-deferred-style>',
        '<noscript><link rel="stylesheet" href="/assets/app.css"></noscript>',
        '<link rel="modulepreload" href="/c/app.client.js">',
        '<script>globalThis.ready = true;</script>',
        '</head><body><main>Question</main></body></html>',
      ].join(''),
      new URL('https://example.test/questions/q3'),
    );

    expect(inventory.renderBlockingStylesheetUrls).toEqual([]);
    expect(inventory.stylesheets).toMatchObject([
      {
        attrs: expect.objectContaining({ as: 'style', rel: 'preload' }),
        url: 'https://example.test/assets/app.css',
      },
    ]);
    expect(inventory.noscriptStylesheetHrefs).toEqual(['https://example.test/assets/app.css']);
    expect(inventory.modulepreloads).toMatchObject([
      { url: 'https://example.test/c/app.client.js' },
    ]);
    expect(inventory.criticalAssetUrls).toEqual([
      'https://example.test/assets/app.css',
      'https://example.test/c/app.client.js',
    ]);
    expect(inventory.inlineStyleBytes).toBe(Buffer.byteLength('body{color:red}', 'utf8'));
    expect(inventory.inlineScriptBytes).toBe(Buffer.byteLength('globalThis.ready = true;', 'utf8'));
    expect(inventory.bodyBytes).toBe(Buffer.byteLength('<main>Question</main>', 'utf8'));
  });

  it('reports active render-blocking stylesheets and duplicate asset identities', () => {
    const inventory = htmlAssetInventory(
      [
        '<html><head>',
        '<link rel="stylesheet" href="/assets/app.css">',
        '<link rel="stylesheet" href="/assets/app.css">',
        '<script src="/c/app.js"></script>',
        '<script src="/c/app.js"></script>',
        '</head><body></body></html>',
      ].join(''),
      new URL('https://example.test/'),
    );

    expect(inventory.renderBlockingStylesheetUrls).toEqual([
      'https://example.test/assets/app.css',
      'https://example.test/assets/app.css',
    ]);
    expect(inventory.duplicateAssetUrls).toEqual([
      'https://example.test/assets/app.css',
      'https://example.test/c/app.js',
    ]);
  });

  it('binds axe results to an explicit terminal state and exact engine bytes', () => {
    const result = summarizeAxeResult(
      {
        testEngine: { name: 'axe-core', version: '4.12.1' },
        incomplete: [],
        passes: [{ id: 'document-title', nodes: [{ target: ['html'] }] }],
        violations: [
          {
            id: 'button-name',
            impact: 'critical',
            help: 'Buttons must have discernible text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/button-name',
            nodes: [
              {
                target: ['#save'],
                failureSummary: 'Fix the button label.',
              },
            ],
          },
        ],
      },
      {
        sourceDigest: `sha256:${'a'.repeat(64)}`,
        terminalState: {
          name: 'authenticated-dashboard',
          selector: 'main[data-journey-state="ready"]',
        },
      },
    );

    expect(result).toMatchObject({
      engine: {
        name: 'axe-core',
        version: '4.12.1',
        sourceSha256: `sha256:${'a'.repeat(64)}`,
      },
      pass: false,
      terminalState: {
        name: 'authenticated-dashboard',
        selector: 'main[data-journey-state="ready"]',
      },
      violations: [
        {
          id: 'button-name',
          impact: 'critical',
          nodes: [{ target: ['#save'], failureSummary: 'Fix the button label.' }],
        },
      ],
    });
    expect(result.passes).toEqual([{ id: 'document-title', nodes: 1 }]);
  });

  it('rejects accessibility requests that cannot produce browser evidence before I/O', async () => {
    await expect(
      runFcpHarness({
        accessibility: true,
        browser: false,
        terminalState: { name: 'ready', selector: 'main' },
        url: 'http://unreachable.invalid/',
      }),
    ).rejects.toThrow('accessibility capture requires browser mode');

    await expect(
      runFcpHarness({
        accessibility: true,
        url: 'http://unreachable.invalid/',
      }),
    ).rejects.toThrow('accessibility capture requires an explicit terminal state');
  });
});
