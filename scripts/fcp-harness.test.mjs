import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  browserGateResult,
  fcpGateResult,
  fcpHarnessExitCode,
  htmlAssetInventory,
  runLighthouse,
  runFcpHarness,
  summarizeAxeResult,
} from './fcp-harness.mjs';

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
          matchCount: 1,
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
        matchCount: 1,
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

  it('rejects non-2xx documents and critical assets', async () => {
    await withHarnessServer(
      (_request, response) => {
        response.writeHead(500, { 'Content-Type': 'text/html' });
        response.end('<html><body>failed</body></html>');
      },
      async ({ outputDir, url }) => {
        await expect(runFcpHarness({ browser: false, outputDir, url })).rejects.toThrow(
          'document request returned non-success status 500',
        );
      },
    );

    await withHarnessServer(
      (request, response) => {
        if (request.url === '/missing.js') {
          response.writeHead(404, { 'Content-Type': 'text/javascript' });
          response.end('not found');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<html><body>ready<script src="/missing.js" type="module"></script></body></html>',
        );
      },
      async ({ outputDir, url }) => {
        await expect(runFcpHarness({ browser: false, outputDir, url })).rejects.toThrow(
          'critical asset request returned non-success status 404',
        );
      },
    );
  });

  it('bounds the number of critical asset probes before making asset requests', async () => {
    await expect(
      runFcpHarness({
        browser: false,
        maxCriticalAssetCount: Number.MAX_SAFE_INTEGER,
        url: 'http://unreachable.invalid/',
      }),
    ).rejects.toThrow('maxCriticalAssetCount must be a positive integer no greater than');

    const requestedPaths = [];
    await withHarnessServer(
      (request, response) => {
        requestedPaths.push(request.url);
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          [
            '<html><body>ready',
            '<script src="/one.js"></script>',
            '<script src="/two.js"></script>',
            '<script src="/three.js"></script>',
            '</body></html>',
          ].join(''),
        );
      },
      async ({ outputDir, url }) => {
        await expect(
          runFcpHarness({
            browser: false,
            maxCriticalAssetCount: 2,
            outputDir,
            url,
          }),
        ).rejects.toThrow('critical asset inventory contains 3 URLs, exceeding the limit of 2');
      },
    );
    expect(requestedPaths).toEqual(['/']);
  });

  it('bounds request duration and encoded response bodies', async () => {
    await expect(
      runFcpHarness({
        browser: false,
        maxEncodedBodyBytes: Number.MAX_SAFE_INTEGER,
        url: 'http://unreachable.invalid/',
      }),
    ).rejects.toThrow('maxEncodedBodyBytes must be a positive integer no greater than');

    await withHarnessServer(
      () => undefined,
      async ({ outputDir, url }) => {
        await expect(
          runFcpHarness({
            browser: false,
            outputDir,
            requestTimeoutMs: 25,
            url,
          }),
        ).rejects.toThrow('request exceeded 25 ms');
      },
    );

    await withHarnessServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('x'.repeat(128));
      },
      async ({ outputDir, url }) => {
        await expect(
          runFcpHarness({
            browser: false,
            maxEncodedBodyBytes: 64,
            outputDir,
            url,
          }),
        ).rejects.toThrow('encoded response exceeded 64 bytes');
      },
    );
  });

  it('bounds decompressed bodies before parsing HTML', async () => {
    const compressed = gzipSync(`<html><body>${'compressible'.repeat(64)}</body></html>`);
    await withHarnessServer(
      (_request, response) => {
        response.writeHead(200, {
          'Content-Encoding': 'gzip',
          'Content-Type': 'text/html',
        });
        response.end(compressed);
      },
      async ({ outputDir, url }) => {
        await expect(
          runFcpHarness({
            browser: false,
            maxDecodedBodyBytes: 64,
            maxEncodedBodyBytes: 1024,
            outputDir,
            url,
          }),
        ).rejects.toThrow('decoded response exceeded 64 bytes');
      },
    );
  });

  it('fails browser evidence without accessibility when text, console, page, or FCP facts fail', async () => {
    await withHarnessServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html><body>ready</body></html>');
      },
      async ({ outputDir, url }) => {
        const result = await runFcpHarness({
          outputDir,
          runBrowserSmoke: async () => [
            {
              consoleErrors: ['console exploded'],
              firstViewportTextVisible: false,
              pageErrors: ['page exploded'],
              paintEntries: [],
              screenshot: {
                bytes: 1,
                sha256: `sha256:${'a'.repeat(64)}`,
              },
              viewport: { name: 'hostile' },
            },
          ],
          url,
        });

        expect(result.browserGate).toEqual({
          failures: [
            'hostile: first viewport has no text',
            'hostile: 1 console error(s)',
            'hostile: 1 page error(s)',
            'hostile: first-contentful-paint was not observed',
          ],
          pass: false,
        });
        expect(result.gate.failures).toEqual(
          result.browserGate.failures.map((failure) => `browser: ${failure}`),
        );
        expect(fcpHarnessExitCode(result)).toBe(1);
      },
    );
  });

  it('accepts complete browser evidence without requiring accessibility-only facts', () => {
    expect(
      browserGateResult(
        [
          {
            consoleErrors: [],
            firstViewportTextVisible: true,
            pageErrors: [],
            paintEntries: [{ name: 'first-contentful-paint', startTime: 0 }],
            screenshot: {
              bytes: 1,
              sha256: `sha256:${'a'.repeat(64)}`,
            },
            viewport: { name: 'desktop' },
          },
        ],
        { accessibilityRequested: false },
      ),
    ).toEqual({ failures: [], pass: true });
  });

  it('makes a requested Lighthouse failure fail the harness gate and CLI status', async () => {
    await withHarnessServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html><body>ready</body></html>');
      },
      async ({ outputDir, url }) => {
        const result = await runFcpHarness({
          browser: false,
          lighthouse: true,
          outputDir,
          runLighthouse: () => ({
            error: 'hostile lighthouse failure',
            ok: false,
            outputPath: path.join(outputDir, 'lighthouse.json'),
          }),
          url,
        });

        expect(result.gate).toEqual({
          failures: ['lighthouse: hostile lighthouse failure'],
          pass: false,
        });
        expect(fcpHarnessExitCode(result)).toBe(1);
      },
    );
  });

  it.each([
    ['missing', null],
    ['not finite', Number.NaN],
    ['negative', -1],
  ])('rejects %s Lighthouse first-contentful-paint evidence', (_label, fcpMs) => {
    expect(
      fcpGateResult(
        {
          lighthouse: {
            audits: { fcpMs },
            ok: true,
          },
        },
        { lighthouseRequested: true },
      ),
    ).toEqual({
      failures: ['lighthouse: first-contentful-paint is missing or invalid'],
      pass: false,
    });
  });

  it('passes the bounded timeout to the Lighthouse subprocess and fails a timeout closed', () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-fcp-lighthouse-test-'));
    let spawnOptions;
    try {
      const result = runLighthouse(new URL('https://example.test/'), outputDir, {
        spawn: (_command, _args, options) => {
          spawnOptions = options;
          return {
            error: Object.assign(new Error('spawn timed out'), { code: 'ETIMEDOUT' }),
            status: null,
            stderr: '',
            stdout: '',
          };
        },
        timeoutMs: 37,
      });

      expect(spawnOptions).toMatchObject({ encoding: 'utf8', timeout: 37 });
      expect(result).toMatchObject({
        error: 'lighthouse exceeded 37 ms',
        ok: false,
      });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('enforces one global deadline across browser and Lighthouse operations', async () => {
    await withHarnessServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html><body>ready</body></html>');
      },
      async ({ outputDir, url }) => {
        await expect(
          runFcpHarness({
            harnessTimeoutMs: 25,
            outputDir,
            runBrowserSmoke: async () => await new Promise(() => undefined),
            url,
          }),
        ).rejects.toThrow('FCP harness exceeded 25 ms global deadline');

        await expect(
          runFcpHarness({
            browser: false,
            harnessTimeoutMs: 25,
            lighthouse: true,
            lighthouseTimeoutMs: 1_000,
            outputDir,
            runLighthouse: async () => await new Promise(() => undefined),
            url,
          }),
        ).rejects.toThrow('FCP harness exceeded 25 ms global deadline');
      },
    );
  });

  it('lets the global deadline preempt a longer per-request timeout', async () => {
    await withHarnessServer(
      () => undefined,
      async ({ outputDir, url }) => {
        await expect(
          runFcpHarness({
            browser: false,
            harnessTimeoutMs: 25,
            outputDir,
            requestTimeoutMs: 1_000,
            url,
          }),
        ).rejects.toThrow('FCP harness exceeded 25 ms global deadline');
      },
    );
  });
});

async function withHarnessServer(handler, callback) {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-fcp-harness-test-'));
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    await callback({
      outputDir,
      url: `http://127.0.0.1:${address.port}/`,
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    rmSync(outputDir, { recursive: true, force: true });
  }
}
