import { describe, expect, it } from 'vitest';

import { htmlAssetInventory } from './fcp-harness.mjs';

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
});
