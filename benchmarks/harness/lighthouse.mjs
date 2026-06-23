import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const RUNS = [
  { formFactor: 'desktop', path: '/' },
  { formFactor: 'desktop', path: '/product/linen-field-jacket' },
  { formFactor: 'mobile', path: '/' },
  { formFactor: 'mobile', path: '/product/linen-field-jacket' },
];

export async function runLighthouse(origin) {
  const chrome = await launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const results = [];
    for (const run of RUNS) {
      const flags = {
        formFactor: run.formFactor,
        logLevel: 'error',
        onlyCategories: ['performance'],
        output: 'json',
        port: chrome.port,
        screenEmulation:
          run.formFactor === 'desktop'
            ? { disabled: false, deviceScaleFactor: 1, height: 940, mobile: false, width: 1350 }
            : undefined,
      };
      const result = await lighthouse(`${origin}${run.path}`, flags);
      const lhr = result?.lhr;
      results.push({
        formFactor: run.formFactor,
        metrics: extractMetrics(lhr),
        path: run.path,
      });
    }
    return results;
  } finally {
    await chrome.kill();
  }
}

function extractMetrics(lhr) {
  const audits = lhr?.audits ?? {};
  return {
    bytes: audits['total-byte-weight']?.numericValue ?? null,
    fcpMs: audits['first-contentful-paint']?.numericValue ?? null,
    lcpMs: audits['largest-contentful-paint']?.numericValue ?? null,
    performanceScore: lhr?.categories?.performance?.score ?? null,
    speedIndexMs: audits['speed-index']?.numericValue ?? null,
    tbtMs: audits['total-blocking-time']?.numericValue ?? null,
    ttiMs: audits.interactive?.numericValue ?? null,
  };
}
