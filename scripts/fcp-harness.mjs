import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

const defaultAcceptEncoding = 'br,gzip';
const defaultViewports = [
  { height: 844, name: 'mobile', width: 390 },
  { height: 900, name: 'desktop', width: 1440 },
];

export async function runFcpHarness(options) {
  const url = new URL(options.url);
  const outputDir = options.outputDir ?? defaultOutputDir(url);
  mkdirSync(outputDir, { recursive: true });

  const documentProbe = await probeUrl(url, {
    acceptEncoding: options.acceptEncoding ?? defaultAcceptEncoding,
  });
  const documentHtml = decodeProbeBody(documentProbe).toString('utf8');
  const inventory = htmlAssetInventory(documentHtml, url);
  const assetProbes = [];

  for (const assetUrl of inventory.criticalAssetUrls) {
    assetProbes.push(
      await probeUrl(assetUrl, { acceptEncoding: options.acceptEncoding ?? defaultAcceptEncoding }),
    );
  }

  const browser = options.browser === false ? undefined : await runBrowserSmoke(url, outputDir);
  const lighthouse = options.lighthouse ? runLighthouse(url, outputDir) : undefined;
  const result = {
    assetProbes: assetProbes.map(probeSummary),
    browser,
    document: probeSummary(documentProbe),
    inventory,
    lighthouse,
    outputDir,
    url: url.href,
  };

  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function probeUrl(url, options = {}, redirectCount = 0) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const startedAt = performance.now();

  return await new Promise((resolve, reject) => {
    const request = transport(
      target,
      {
        headers: {
          'Accept-Encoding': options.acceptEncoding ?? defaultAcceptEncoding,
          'User-Agent': 'kovo-fcp-harness/1',
        },
      },
      (response) => {
        const chunks = [];
        let firstByteAt;
        response.once('data', () => {
          firstByteAt = performance.now();
        });
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', async () => {
          const status = response.statusCode ?? 0;
          const location = readHeader(response.headers, 'location');
          if (status >= 300 && status < 400 && location && redirectCount < 5) {
            try {
              resolve(
                await probeUrl(new URL(location, target), options, redirectCount + 1),
              );
            } catch (error) {
              reject(error);
            }
            return;
          }
          const endedAt = performance.now();
          resolve({
            body: Buffer.concat(chunks),
            headers: normalizedHeaders(response.headers),
            status,
            statusText: response.statusMessage ?? '',
            timings: {
              totalMs: Math.round((endedAt - startedAt) * 10) / 10,
              ttfbMs:
                firstByteAt === undefined
                  ? null
                  : Math.round((firstByteAt - startedAt) * 10) / 10,
            },
            url: target.href,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

export function htmlAssetInventory(html, baseUrl) {
  const activeHtml = stripNoscript(html);
  const links = readOpeningTags(activeHtml, 'link').map((tag) => ({
    attrs: parseAttributes(tag.attrs),
    source: tag.source,
  }));
  const noscriptLinks = readNoscriptLinks(html, baseUrl);
  const activeStylesheets = links
    .filter((link) => isStylesheetLike(link.attrs))
    .map((link) => linkFact(link, baseUrl));
  const modulepreloads = links
    .filter((link) => relTokens(link.attrs.rel).includes('modulepreload') && link.attrs.href)
    .map((link) => linkFact(link, baseUrl));
  const scripts = readElementChunks(activeHtml, 'script');
  const externalScripts = scripts
    .map((script) => ({ attrs: parseAttributes(script.attrs), source: script.source }))
    .filter((script) => script.attrs.src)
    .map((script) => ({
      attrs: script.attrs,
      url: new URL(script.attrs.src, baseUrl).href,
    }));
  const inlineScripts = scripts.filter((script) => !parseAttributes(script.attrs).src);
  const inlineStyles = readElementChunks(activeHtml, 'style');
  const criticalStyles = inlineStyles
    .map((style) => ({ attrs: parseAttributes(style.attrs), bytes: byteLength(style.content) }))
    .filter((style) => style.attrs['data-kovo-critical-href']);
  const assetUrls = [
    ...activeStylesheets.map((link) => link.url),
    ...modulepreloads.map((link) => link.url),
    ...externalScripts.map((script) => script.url),
  ];

  return {
    bodyBytes: byteLength(readBodyHtml(html)),
    criticalAssetUrls: unique(assetUrls),
    criticalStyles,
    duplicateAssetUrls: duplicates(assetUrls),
    inlineScriptBytes: inlineScripts.reduce((total, script) => total + byteLength(script.content), 0),
    inlineStyleBytes: inlineStyles.reduce((total, style) => total + byteLength(style.content), 0),
    modulepreloads,
    noscriptStylesheetHrefs: noscriptLinks
      .filter((link) => relTokens(link.attrs.rel).includes('stylesheet') && link.attrs.href)
      .map((link) => link.url),
    renderBlockingStylesheetUrls: activeStylesheets
      .filter((link) => relTokens(link.attrs.rel).includes('stylesheet'))
      .map((link) => link.url),
    stylesheets: activeStylesheets,
    totalHtmlBytes: byteLength(html),
  };
}

function runLighthouse(url, outputDir) {
  const outputPath = join(outputDir, 'lighthouse.json');
  const result = spawnSync(
    'npx',
    [
      '--yes',
      'lighthouse',
      url.href,
      '--output=json',
      `--output-path=${outputPath}`,
      '--only-categories=performance',
      '--chrome-flags=--headless=new --no-sandbox',
      '--quiet',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    return {
      error: result.stderr || result.stdout || `lighthouse exited ${result.status}`,
      outputPath,
      ok: false,
    };
  }

  const report = JSON.parse(readFileSync(outputPath, 'utf8'));
  return {
    audits: {
      fcpMs: report.audits?.['first-contentful-paint']?.numericValue ?? null,
      lcpMs: report.audits?.['largest-contentful-paint']?.numericValue ?? null,
      renderBlocking: report.audits?.['render-blocking-resources']?.details?.items ?? [],
      serverResponseTimeMs: report.audits?.['server-response-time']?.numericValue ?? null,
      speedIndexMs: report.audits?.['speed-index']?.numericValue ?? null,
      totalBlockingTimeMs: report.audits?.['total-blocking-time']?.numericValue ?? null,
      unusedJavascript: report.audits?.['unused-javascript']?.details?.items ?? [],
    },
    outputPath,
    ok: true,
    performanceScore: report.categories?.performance?.score ?? null,
  };
}

async function runBrowserSmoke(url, outputDir) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const results = [];

  try {
    for (const viewport of defaultViewports) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto(url.href, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
      const screenshotPath = join(outputDir, `${viewport.name}.png`);
      await page.screenshot({ fullPage: false, path: screenshotPath });
      const facts = await page.evaluate(() => {
        const paintEntries = performance.getEntriesByType('paint').map((entry) => ({
          name: entry.name,
          startTime: Math.round(entry.startTime * 10) / 10,
        }));
        const resources = performance.getEntriesByType('resource').map((entry) => ({
          decodedBodySize: entry.decodedBodySize,
          encodedBodySize: entry.encodedBodySize,
          initiatorType: entry.initiatorType,
          name: entry.name,
          responseEnd: Math.round(entry.responseEnd * 10) / 10,
          startTime: Math.round(entry.startTime * 10) / 10,
          transferSize: entry.transferSize,
        }));
        const bodyStyle = getComputedStyle(document.body);
        const firstViewportTextVisible =
          document.body.innerText.trim().length > 0 &&
          bodyStyle.display !== 'none' &&
          bodyStyle.visibility !== 'hidden';

        return {
          deferredStylesheetCount: document.querySelectorAll(
            'link[data-kovo-deferred-style]',
          ).length,
          firstViewportTextVisible,
          paintEntries,
          resources,
          title: document.title,
        };
      });

      await page.close();
      results.push({
        ...facts,
        consoleErrors,
        pageErrors,
        screenshotPath,
        viewport,
      });
    }
  } finally {
    await browser.close();
  }

  return results;
}

function probeSummary(probe) {
  return {
    contentEncoding: readHeader(probe.headers, 'content-encoding') ?? null,
    contentType: readHeader(probe.headers, 'content-type') ?? null,
    decodedBytes: decodeProbeBody(probe).byteLength,
    encodedBytes: probe.body.byteLength,
    headers: probe.headers,
    status: probe.status,
    timings: probe.timings,
    url: probe.url,
    vary: readHeader(probe.headers, 'vary') ?? null,
  };
}

function decodeProbeBody(probe) {
  const encoding = (readHeader(probe.headers, 'content-encoding') ?? '').toLowerCase();
  if (encoding === 'br') return brotliDecompressSync(probe.body);
  if (encoding === 'gzip') return gunzipSync(probe.body);
  if (encoding === 'deflate') return inflateSync(probe.body);
  return probe.body;
}

function readOpeningTags(html, tagName) {
  const tags = [];
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b([^>]*)>`, 'gi');
  for (const match of html.matchAll(pattern)) {
    tags.push({ attrs: match[1] ?? '', source: match[0] ?? '' });
  }
  return tags;
}

function readElementChunks(html, tagName) {
  const chunks = [];
  const pattern = new RegExp(
    `<${escapeRegExp(tagName)}\\b([^>]*)>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`,
    'gi',
  );
  for (const match of html.matchAll(pattern)) {
    chunks.push({
      attrs: match[1] ?? '',
      content: match[2] ?? '',
      source: match[0] ?? '',
    });
  }
  return chunks;
}

function readNoscriptLinks(html, baseUrl) {
  return readElementChunks(html, 'noscript').flatMap((chunk) =>
    readOpeningTags(chunk.content, 'link')
      .map((tag) => ({ attrs: parseAttributes(tag.attrs) }))
      .filter((link) => link.attrs.href)
      .map((link) => linkFact(link, baseUrl)),
  );
}

function parseAttributes(source) {
  const attrs = {};
  const pattern =
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = (match[1] ?? '').toLowerCase();
    if (!name || name === '/') continue;
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function linkFact(link, baseUrl) {
  return {
    attrs: link.attrs,
    url: new URL(link.attrs.href, baseUrl).href,
  };
}

function isStylesheetLike(attrs) {
  const rel = relTokens(attrs.rel);
  return (
    Boolean(attrs.href) &&
    (rel.includes('stylesheet') || (rel.includes('preload') && attrs.as === 'style'))
  );
}

function relTokens(value = '') {
  return String(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : (value ?? '');
  }
  return result;
}

function readHeader(headers, name) {
  return headers[name.toLowerCase()] ?? headers[name] ?? null;
}

function readBodyHtml(html) {
  return /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? '';
}

function stripNoscript(html) {
  return html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function defaultOutputDir(url) {
  const safeName = `${url.hostname}${url.pathname}`.replace(/[^a-z0-9.-]+/gi, '-');
  return join('test-results', 'fcp-harness', `${safeName}-${Date.now()}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCliArgs(args) {
  const options = { browser: true, lighthouse: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--lighthouse') {
      options.lighthouse = true;
      continue;
    }
    if (arg === '--no-browser') {
      options.browser = false;
      continue;
    }
    if (arg === '--output') {
      const outputDir = args[index + 1];
      if (!outputDir) throw new Error('Missing value for --output.');
      options.outputDir = outputDir;
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.outputDir = arg.slice('--output='.length);
      if (!options.outputDir) throw new Error('Missing value for --output.');
      continue;
    }
    if (arg === '--accept-encoding') {
      const acceptEncoding = args[index + 1];
      if (!acceptEncoding) throw new Error('Missing value for --accept-encoding.');
      options.acceptEncoding = acceptEncoding;
      index += 1;
      continue;
    }
    if (arg.startsWith('--accept-encoding=')) {
      options.acceptEncoding = arg.slice('--accept-encoding='.length);
      if (!options.acceptEncoding) throw new Error('Missing value for --accept-encoding.');
      continue;
    }
    if (arg === '--url') {
      const url = args[index + 1];
      if (!url) throw new Error('Missing value for --url.');
      options.url = url;
      index += 1;
      continue;
    }
    if (arg.startsWith('--url=')) {
      options.url = arg.slice('--url='.length);
      if (!options.url) throw new Error('Missing value for --url.');
      continue;
    }
    if (!arg.startsWith('-') && !options.url) {
      options.url = arg;
      continue;
    }
    throw new Error(`Unknown fcp-harness option ${JSON.stringify(arg)}.`);
  }
  if (!options.url) {
    throw new Error(
      `Usage: node ${basename(process.argv[1] ?? 'scripts/fcp-harness.mjs')} <url> [--json] [--lighthouse] [--no-browser] [--output <dir>]`,
    );
  }
  return options;
}

function printTextSummary(result) {
  const lines = [
    'kovo-fcp-harness/v1',
    `url=${result.url}`,
    `output-dir=${result.outputDir}`,
    `document-status=${result.document.status}`,
    `document-encoded-bytes=${result.document.encodedBytes}`,
    `document-decoded-bytes=${result.document.decodedBytes}`,
    `document-content-encoding=${result.document.contentEncoding ?? '-'}`,
    `document-vary=${result.document.vary ?? '-'}`,
    `document-ttfb-ms=${result.document.timings.ttfbMs ?? '-'}`,
    `inline-style-bytes=${result.inventory.inlineStyleBytes}`,
    `inline-script-bytes=${result.inventory.inlineScriptBytes}`,
    `body-bytes=${result.inventory.bodyBytes}`,
    `render-blocking-stylesheets=${result.inventory.renderBlockingStylesheetUrls.join(',') || '-'}`,
    `stylesheets=${result.inventory.stylesheets.map((link) => link.url).join(',') || '-'}`,
    `modulepreloads=${result.inventory.modulepreloads.map((link) => link.url).join(',') || '-'}`,
    `noscript-stylesheets=${result.inventory.noscriptStylesheetHrefs.join(',') || '-'}`,
    `duplicate-assets=${result.inventory.duplicateAssetUrls.join(',') || '-'}`,
    ...result.assetProbes.flatMap((probe) => [
      `asset=${probe.url}`,
      `  status=${probe.status}`,
      `  encoded-bytes=${probe.encodedBytes}`,
      `  decoded-bytes=${probe.decodedBytes}`,
      `  content-encoding=${probe.contentEncoding ?? '-'}`,
      `  content-type=${probe.contentType ?? '-'}`,
      `  vary=${probe.vary ?? '-'}`,
    ]),
  ];

  for (const smoke of result.browser ?? []) {
    lines.push(
      `browser-${smoke.viewport.name}-fcp-ms=${
        smoke.paintEntries.find((entry) => entry.name === 'first-contentful-paint')?.startTime ??
        '-'
      }`,
      `browser-${smoke.viewport.name}-visible=${smoke.firstViewportTextVisible}`,
      `browser-${smoke.viewport.name}-resources=${smoke.resources.length}`,
      `browser-${smoke.viewport.name}-console-errors=${smoke.consoleErrors.length}`,
      `browser-${smoke.viewport.name}-page-errors=${smoke.pageErrors.length}`,
      `browser-${smoke.viewport.name}-screenshot=${smoke.screenshotPath}`,
    );
  }

  if (result.lighthouse) {
    lines.push(
      `lighthouse-ok=${result.lighthouse.ok}`,
      `lighthouse-output=${result.lighthouse.outputPath}`,
    );
    if (result.lighthouse.ok) {
      lines.push(
        `lighthouse-score=${result.lighthouse.performanceScore}`,
        `lighthouse-fcp-ms=${result.lighthouse.audits.fcpMs}`,
        `lighthouse-lcp-ms=${result.lighthouse.audits.lcpMs}`,
        `lighthouse-tbt-ms=${result.lighthouse.audits.totalBlockingTimeMs}`,
        `lighthouse-render-blocking-count=${result.lighthouse.audits.renderBlocking.length}`,
      );
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = await runFcpHarness(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else printTextSummary(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
