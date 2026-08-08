import { chromium } from 'playwright';

/**
 * Back/forward-cache participation probe.
 *
 * plans/good-perf.md O15 recorded that "bfcache participation could not be measured for EITHER
 * framework because Playwright's chrome-headless-shell launches with --disable-back-forward-cache".
 * Both halves of that are fixable from the harness:
 *
 *  - `chrome-headless-shell` (Playwright's default `headless: true` browser) is a stripped shell
 *    that does not implement the back/forward cache at all, so this probe asks for the full
 *    Chromium build with `channel: 'chromium'`.
 *  - Playwright injects `--disable-back-forward-cache` into its default argument list, so this
 *    probe removes it with `ignoreDefaultArgs`.
 *
 * Because those two changes alter the browser under test, the probe runs in its OWN browser
 * process and never shares one with the timing scenarios — a bfcache-enabled full Chromium is not
 * the same instrument as the one that produced the FCP/LCP numbers, and the report says so.
 *
 * SPEC §8 (spec/07-navigation.md) makes bfcache load-bearing for Kovo: "Enhanced navigation must not
 * add `unload` handlers or global session heaps that block bfcache", and guarded/session-dependent
 * documents must be `no-store` (which legitimately blocks disk persistence). A non-restore is
 * therefore only a defect when the document is anonymous; `notRestoredReasons` is captured so the
 * two cases are distinguishable rather than collapsed into one boolean.
 */
export async function runBfcacheProbe({ iterations = 3, origin }) {
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
    });
  } catch (error) {
    return {
      available: false,
      browser: null,
      iterations: [],
      unavailableReason: `Could not launch full Chromium with the back/forward cache enabled: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    const results = [];
    for (let index = 0; index < iterations; index += 1) {
      results.push(await probeOnce(browser, origin));
    }
    // The back/forward cache only exists for CROSS-document history traversal. A framework whose
    // in-app navigation stays in one document never creates a bfcache entry to restore, so scoring
    // it "0 restored" against a framework that replaces the document would be a false comparison in
    // the document-replacing framework's favour. Applicability is therefore reported separately.
    const applicable = results.filter((result) => result.applicable);
    const restored = applicable.filter((result) => result.restored).length;
    return {
      applicableCount: applicable.length,
      available: true,
      browser: browser.version(),
      iterations: results,
      notRestoredReasons: [
        ...new Set(results.flatMap((result) => result.notRestoredReasons ?? [])),
      ].sort(),
      restoredCount: restored,
      restoredRate: applicable.length === 0 ? null : restored / applicable.length,
      unavailableReason: null,
    };
  } finally {
    await browser.close();
  }
}

async function probeOnce(browser, origin) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__kovoBenchBfcacheRestored = false;
    addEventListener('pageshow', (event) => {
      if (event.persisted) window.__kovoBenchBfcacheRestored = true;
    });
  });

  try {
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    const link = page.locator('a[aria-label^="View "]').first();
    const targetPath = new URL(await link.getAttribute('href'), origin).pathname;
    await page.evaluate(() => {
      window.__kovoBenchBfcacheSentinel = true;
    });
    // A document is only eligible once it has been navigated away from, so drive a real in-app
    // navigation rather than a scripted history push.
    await link.click();
    await page.waitForURL((url) => url.pathname === targetPath);
    await page.waitForSelector('main h1');
    const leftTheDocument = await page.evaluate(
      () => window.__kovoBenchBfcacheSentinel !== true,
    );
    await page.waitForTimeout(250);
    // `waitUntil: 'load'` cannot be used here: a bfcache restore fires no `load` event, so waiting
    // for one times out on exactly the outcome being probed. Commit, then let `pageshow` land.
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForTimeout(500);

    const observed = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      const notRestored = entry?.notRestoredReasons ?? null;
      const reasons = [];
      const walk = (node) => {
        if (!node) return;
        for (const reason of node.reasons ?? []) {
          reasons.push(typeof reason === 'string' ? reason : (reason?.reason ?? String(reason)));
        }
        for (const child of node.children ?? []) walk(child);
      };
      walk(notRestored);
      return {
        navigationType: entry?.type ?? null,
        notRestoredReasons: reasons,
        // `notRestoredReasons` is only exposed for same-origin main frames; null means the browser
        // declined to answer, which is NOT the same as "restored".
        notRestoredReasonsAvailable: notRestored !== null,
        restored: window.__kovoBenchBfcacheRestored === true,
      };
    });
    return {
      ...observed,
      applicable: leftTheDocument,
      notApplicableReason: leftTheDocument
        ? null
        : 'in-app navigation stayed in one document, so the history traversal never involved the back/forward cache',
    };
  } finally {
    await context.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const originIndex = process.argv.indexOf('--origin');
  const origin = originIndex === -1 ? 'http://127.0.0.1:3000' : process.argv[originIndex + 1];
  const iterationsIndex = process.argv.indexOf('--iterations');
  const iterations = iterationsIndex === -1 ? 3 : Number(process.argv[iterationsIndex + 1]);
  process.stdout.write(
    `${JSON.stringify(await runBfcacheProbe({ iterations, origin }), null, 2)}\n`,
  );
}
