import { chromium } from 'playwright';

import { readArg, readIntegerArg } from './args.mjs';

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
export async function runBfcacheProbe({ iterations = 3, listingPath = '/', origin }) {
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
      results.push(await probeOnce(browser, origin, listingPath));
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

async function probeOnce(browser, origin, listingPath) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The probe drives two real document loads per iteration in its own browser. That traffic used
  // to carry no status tracking at all, so a probe run entirely under 429 load shedding was
  // indistinguishable from a healthy one. Counted here and checked by run-all.mjs.
  const network = {
    errorResponses: 0,
    failedRequests: 0,
    failureReasons: [],
    pageErrors: 0,
    rateLimitedResponses: 0,
    requests: 0,
  };
  page.on('response', (response) => {
    network.requests += 1;
    const status = response.status();
    if (status === 429) network.rateLimitedResponses += 1;
    else if (status >= 400) network.errorResponses += 1;
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    if (reason.includes('net::ERR_ABORTED')) return;
    network.failedRequests += 1;
    if (!network.failureReasons.includes(reason)) network.failureReasons.push(reason);
  });
  page.on('pageerror', () => {
    network.pageErrors += 1;
  });
  await page.addInitScript(() => {
    window.__kovoBenchBfcacheRestored = false;
    addEventListener('pageshow', (event) => {
      if (event.persisted) window.__kovoBenchBfcacheRestored = true;
    });
  });

  try {
    await page.goto(`${origin}${listingPath}`, { waitUntil: 'load' });
    const initialListing = await page.evaluate(() => ({
      cards: document.querySelectorAll('main .card').length,
      heading: document.querySelector('main h1')?.textContent?.trim() ?? null,
    }));
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
    const leftTheDocument = await page.evaluate(() => window.__kovoBenchBfcacheSentinel !== true);
    await page.waitForTimeout(250);
    // `waitUntil: 'load'` cannot be used here: a bfcache restore fires no `load` event, so waiting
    // for one times out on exactly the outcome being probed. Commit, then let `pageshow` land.
    await page.goBack({ waitUntil: 'commit' });
    if (new URL(page.url()).pathname !== listingPath) {
      await page.waitForURL((url) => url.pathname === listingPath);
    }
    await page.locator('main h1').waitFor();
    await page.waitForTimeout(500);

    const observed = await page.evaluate(
      ({ initialListing, listingPath }) => {
        const entries = performance.getEntriesByType('navigation');
        const entry = entries[entries.length - 1];
        const notRestored =
          window.__kovoBenchBfcacheRestored === true ? null : (entry?.notRestoredReasons ?? null);
        const reasons = [];
        const walk = (node) => {
          if (!node) return;
          for (const reason of node.reasons ?? []) {
            reasons.push(typeof reason === 'string' ? reason : (reason?.reason ?? String(reason)));
          }
          for (const child of node.children ?? []) walk(child);
        };
        walk(notRestored);
        const finalHeading = document.querySelector('main h1')?.textContent?.trim() ?? null;
        const finalCards = document.querySelectorAll('main .card').length;
        return {
          finalListing: {
            cards: finalCards,
            contentValid:
              location.pathname === listingPath &&
              finalHeading === initialListing.heading &&
              finalCards === initialListing.cards &&
              finalCards === 24,
            expectedHeading: initialListing.heading,
            heading: finalHeading,
            pathname: location.pathname,
          },
          navigationType: entry?.type ?? null,
          notRestoredReasons: reasons,
          // `notRestoredReasons` is only exposed for same-origin main frames; null means the browser
          // declined to answer, which is NOT the same as "restored".
          notRestoredReasonsAvailable: notRestored !== null,
          originSentinelPresent: window.__kovoBenchBfcacheSentinel === true,
          restored: window.__kovoBenchBfcacheRestored === true,
        };
      },
      { initialListing, listingPath },
    );
    const result = {
      ...observed,
      applicable: leftTheDocument,
      destinationPath: targetPath,
      listingPath,
      network,
      notApplicableReason: leftTheDocument
        ? null
        : 'in-app navigation stayed in one document, so the history traversal never involved the back/forward cache',
    };
    result.evidenceComplete = bfcacheIterationFindings(result, { listingPath }).length === 0;
    return result;
  } finally {
    await context.close();
  }
}

/**
 * Fail-closed evidence check for one history traversal. A successful restore must retain the
 * origin-document sentinel. A non-restore must prove that a new document replaced it and expose
 * Chromium's not-restored tree. Same-document navigation is explicit and must preserve the
 * sentinel, return to the listing URL, and restore the listing content.
 */
export function bfcacheIterationFindings(sample, { listingPath = '/' } = {}) {
  const findings = [];
  if (sample?.listingPath !== listingPath || sample?.finalListing?.pathname !== listingPath) {
    findings.push('history traversal did not return to the expected listing URL');
  }
  if (sample?.finalListing?.contentValid !== true) {
    findings.push('history traversal did not restore the expected listing content');
  }
  if (!Array.isArray(sample?.notRestoredReasons)) {
    findings.push('not-restored reason evidence is malformed');
  }
  if (sample?.applicable === true) {
    if (sample.notApplicableReason !== null) {
      findings.push('applicable traversal carried a not-applicable reason');
    }
    if (sample.restored === true) {
      if (sample.originSentinelPresent !== true) {
        findings.push('reported bfcache restore did not retain the origin-document sentinel');
      }
    } else {
      if (sample.originSentinelPresent !== false) {
        findings.push('reported non-restore did not prove origin-document replacement');
      }
      if (sample.notRestoredReasonsAvailable !== true) {
        findings.push('reported non-restore omitted Chromium not-restored evidence');
      }
    }
  } else if (sample?.applicable === false) {
    if (sample.restored !== false) {
      findings.push('same-document traversal was incorrectly reported as a bfcache restore');
    }
    if (sample.originSentinelPresent !== true) {
      findings.push('same-document traversal did not retain its origin sentinel');
    }
    if (typeof sample.notApplicableReason !== 'string' || sample.notApplicableReason.length === 0) {
      findings.push('same-document traversal omitted its not-applicable reason');
    }
  } else {
    findings.push('bfcache applicability is absent');
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origin = readArg('--origin') || 'http://127.0.0.1:3000';
  // Validated, not `Number()`-coerced: `--iterations three` used to yield NaN, run the probe loop
  // zero times, and report a confident `applicableCount: 0` about a probe that never ran.
  const iterations = readIntegerArg('--iterations', { fallback: 3, max: 1_000 });
  process.stdout.write(
    `${JSON.stringify(await runBfcacheProbe({ iterations, origin }), null, 2)}\n`,
  );
}
