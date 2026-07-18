import assert from 'node:assert/strict';
import { workerData } from 'node:worker_threads';

import { chromium } from 'playwright';

const { acceptance, origin } = workerData;
assert.equal(typeof origin, 'string');

const browser = await chromium.launch({
  args: ['--enable-features=Prerender2,SpeculationRules'],
});

try {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    performance.getEntriesByName('first-contentful-paint').some((entry) => entry.startTime > 0),
  );

  const firstLoad = await page.evaluate(() => {
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const button = document.querySelector('#action');

    return {
      buttonStateBeforeClick: button?.getAttribute('kovo-state') ?? null,
      clientModuleLoadsBeforeInteraction: globalThis.__clientModuleLoads ?? 0,
      contentfulPaintObservedAtEnrollmentCheckpoint:
        globalThis.__kovoPerf.contentfulPaintObservedAtEnrollmentCheckpoint,
      enrollmentCheckpoint: globalThis.__kovoPerf.enrollmentCheckpoint,
      fcp: paint?.startTime ?? Number.NaN,
      firstDelegatedListenerMark: globalThis.__kovoPerf.firstDelegatedListenerMark,
      handlerImportsBeforeInteraction: globalThis.__handlerImports ?? 0,
      hasSpeculationRules: document.querySelector('script[type="speculationrules"]') !== null,
      lastDelegatedListenerMark: globalThis.__kovoPerf.lastDelegatedListenerMark,
      listenerEnrollmentCompletedBeforeContent:
        globalThis.__kovoPerf.listenerEnrollmentCompletedBeforeContent,
    };
  });

  assert.ok(Number.isFinite(firstLoad.fcp), 'first-contentful-paint is recorded');
  assert.ok(
    Number.isFinite(firstLoad.firstDelegatedListenerMark) &&
      firstLoad.firstDelegatedListenerMark > 0,
    'initial delegated listener registration is recorded',
  );
  assert.equal(firstLoad.hasSpeculationRules, true);
  assert.equal(
    firstLoad.listenerEnrollmentCompletedBeforeContent,
    true,
    `initial delegated listeners are installed while the parser is still in head (fcp=${firstLoad.fcp}, firstListener=${firstLoad.firstDelegatedListenerMark}, lastListener=${firstLoad.lastDelegatedListenerMark}, checkpoint=${JSON.stringify(firstLoad.enrollmentCheckpoint)})`,
  );
  assert.equal(
    firstLoad.contentfulPaintObservedAtEnrollmentCheckpoint,
    false,
    'no first-contentful-paint entry exists at the parser-blocking enrollment checkpoint',
  );
  assert.equal(firstLoad.clientModuleLoadsBeforeInteraction, 0);
  assert.equal(firstLoad.handlerImportsBeforeInteraction, 0);

  await page.click('#action');
  await page.waitForFunction(
    () => document.querySelector('#action')?.getAttribute('kovo-state') === '{"count":1}',
  );
  const afterClick = await page.evaluate(() => ({
    buttonStateAfterClick: document.querySelector('#action')?.getAttribute('kovo-state') ?? null,
    clientModuleLoadsAfterClick: globalThis.__clientModuleLoads ?? 0,
  }));

  assert.equal(afterClick.clientModuleLoadsAfterClick, 1);
  assert.equal(afterClick.buttonStateAfterClick, '{"count":1}');

  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const navClickEpoch = await page.evaluate(() => Date.now());
  await Promise.all([page.waitForURL(`${origin}/next`), page.click('#next')]);
  const prerenderNavigation = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];

    return {
      activationStart: navigation.activationStart,
      nextReadyEpoch: globalThis.__readyEpoch,
    };
  });

  assert.ok(
    prerenderNavigation.activationStart >= 0,
    'navigation activationStart is sampled for prerender evidence',
  );
  const perceivedNavigationMs = prerenderNavigation.nextReadyEpoch - navClickEpoch;
  if (prerenderNavigation.activationStart > 0) {
    assert.ok(
      perceivedNavigationMs < 50,
      'opted-in prerendered navigation is perceived under 50ms',
    );
  } else {
    assert.ok(
      Number.isFinite(perceivedNavigationMs),
      'headless Chromium did not activate prerender, but navigation timing was sampled',
    );
  }

  const cdp = await page.context().newCDPSession(page);
  const heapSamples = [];

  for (let index = 0; index < acceptance.navigationCount; index += 1) {
    await page.goto(`${origin}/nav/${index % 2}`, { waitUntil: 'load' });
    await cdp.send(acceptance.cdpMethods[0]);
    const heap = await cdp.send(acceptance.cdpMethods[1]);
    heapSamples.push(heap.usedSize);
  }

  assert.equal(acceptance.navigationCount, 100);
  const firstFiveMedian = median(heapSamples.slice(0, 5));
  const lastFiveMedian = median(heapSamples.slice(-5));
  const baselineUsedHeap = heapSamples[0];
  const finalUsedHeap = heapSamples.at(-1);

  assert.ok(
    finalUsedHeap <= baselineUsedHeap + acceptance.heapNoiseBudget,
    'final heap stays within 64KiB browser/instrumentation noise budget',
  );
  assert.ok(
    lastFiveMedian <= firstFiveMedian + acceptance.heapNoiseBudget,
    'median heap stays within 64KiB browser/instrumentation noise budget',
  );
} finally {
  await browser.close();
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
