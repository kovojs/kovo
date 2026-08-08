#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeReport(resultsPath, reportPath) {
  const data = JSON.parse(await readFile(resultsPath, 'utf8'));
  const lines = [
    '# Benchmark Report',
    '',
    `Generated: ${data.generatedAt}`,
    '',
    runProvenance(data),
    '',
    '## Methodology',
    '',
    'Each app renders the same 24-product catalog, serves the same WebP assets, and exposes the same listing, product detail, cart dialog, and checkout confirmation flow. The custom harness uses fresh browser contexts, cache-cleared runs, Chromium CDP throttling for the mobile profile, request-size accounting to network quiescence, a cart-dialog TTI proxy, a navigation-to-paint probe, and a back/forward-cache probe. Lighthouse runs cover the listing and one product detail page for desktop and mobile presets.',
    '',
    'The headline comparison is architectural, not a claim that one implementation is the only possible tuning for each framework: Kovo is measured as a server-rendered MPA with a platform-native L0 cart dialog and no hydration, while Next.js App Router and TanStack Start are measured with hydrated client cart UI. All apps use plain `<img>` tags to isolate framework behavior from image optimizer behavior.',
    '',
    '## Versions',
    '',
    versionTable(data.apps),
    '',
    '## Runtime posture',
    '',
    postureTable(data.apps),
    '',
    '## Custom Harness Medians',
    '',
    metricTable(data.apps, 'desktop'),
    '',
    metricTable(data.apps, 'mobile'),
    '',
    '## Byte accounting: collection window',
    '',
    'Bytes are collected at network quiescence, not at `load` + 150 ms. The old window is reported alongside so its understatement is visible per run: Kovo imports its deferred client runtime on a double rAF **after** `load`, so a load-window collector reports `js: 0` for an app that ships hundreds of KB of JS.',
    '',
    byteWindowTable(data.apps, 'desktop'),
    '',
    byteWindowTable(data.apps, 'mobile'),
    '',
    '## Navigation',
    '',
    "Measured from the click to the paint that presents the destination: the destination document's browser-recorded first contentful paint when the navigation replaced the document, and the first frame rendered after the destination content is in the DOM when it did not. `Doc replaced` counts the navigations that destroyed the JS realm, i.e. where the framework fell back to a full document load.",
    '',
    '`Superseded probe` reproduces the previous harness metric — wait for `main h1` to exist, then stop. The listing page also has a `main h1`, so that selector is already satisfied by the ORIGIN document and the probe resolves before the navigation commits: it measured harness round-trip latency, not navigation. `Superseded error` is how far low it lands. Do not quote it.',
    '',
    navigationTable(data.apps, 'desktop'),
    '',
    navigationTable(data.apps, 'mobile'),
    '',
    '## Back/forward cache',
    '',
    bfcacheTable(data.apps),
    '',
    '## Lighthouse',
    '',
    data.lighthouseRepeats
      ? `Median of ${data.lighthouseRepeats} runs per cell, with the observed spread (max - min). A cell with any \`null\` samples is not reportable.`
      : '_Skipped for this run (`--skip-lighthouse`)._',
    '',
    lighthouseTable(data.apps),
    '',
    '## Conditions',
    '',
    '- Desktop: Chromium, 1440x900 viewport, no CPU or network throttling.',
    '- Mobile: Chromium, 390x844 viewport, 4x CPU throttle, about 1.6 Mbps down / 750 Kbps up / 150 ms RTT.',
    `- Iterations per app, condition, and custom scenario: ${data.iterations}.`,
    `- Byte-collection settle window: quiet for ${data.settle?.quietMs ?? 'n/a'} ms with zero in-flight requests, capped at ${data.settle?.maxMs ?? 'n/a'} ms.`,
    '',
    '## Known limits of this instrument',
    '',
    "- **The navigation-to-paint probe is biased in favour of document-replacing entrants, and Kovo is the document-replacing entrant.** This bias is one-sided; it does not apply equally to every entrant. The probe's two branches are not the same instrument. When the navigation replaced the document, the reported time is the destination document's own browser-recorded first contentful paint — written by the browser at paint and read afterwards, with no harness cost inside the number. When it did not, no new paint entry is emitted, so the harness polls the page over CDP every 25 ms and then waits two animation frames before reading the clock; one poll interval, one evaluate round-trip and two frames are all inside the same-document number and none of them are inside the document-replacing one. The same branch split also picks different moments: first contentful paint can land before the destination's own `main h1` is painted, while the same-document branch cannot fire before that heading is in the DOM. Both differences push the same way. Nothing here is calibrated out, so a gap of a few tens of milliseconds on desktop — more under the 4x mobile CPU throttle — is within instrument error, and it favours whichever entrant the `Doc replaced` column shows replacing the document. Today that is Kovo, so this instrument errs in Kovo's favour.",
    '- **Wall-clock numbers are only comparable to numbers taken at a similar load.** The load average at the end of the run is recorded above; treat timings taken above roughly 1.0 per core as indicative only. Byte counts are unaffected.',
    '- **Mobile TTFB is not network-realistic.** CDP mobile emulation does not apply the emulated RTT to the first byte, so the mobile TTFB column understates a real mobile connection.',
    '- **The back/forward-cache probe uses a different browser build** than the timing scenarios: full Chromium with `--disable-back-forward-cache` removed. Playwright\'s default `chrome-headless-shell` cannot participate in the back/forward cache at all, so a probe sharing that browser could only ever report "not restored".',
    "- **Nothing is measured over a real network.** The browser, the harness and each entrant's server are three separate processes on the same machine, talking over loopback. Transport cost is excluded for every entrant equally, but no entrant is measured across a real link, so none of these numbers describe behaviour under real RTT, loss, or a CDN.",
    '',
  ];

  await writeFile(reportPath, `${lines.join('\n')}\n`);
}

function runProvenance(data) {
  const machine = data.machine;
  if (!machine) return '_No machine record: this report was produced by an older harness._';
  const load = (machine.loadAverage ?? []).map((value) => value.toFixed(2)).join(' / ');
  return [
    `Run \`${data.runId ?? 'unknown'}\` on ${machine.platform}/${machine.arch}, ${machine.cpus} cores, `,
    `${(machine.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB, node ${machine.node}. `,
    `Load average at end of run (1/5/15 min): **${load}**.`,
  ].join('');
}

function versionTable(apps) {
  return [
    '| App | Framework | Key versions |',
    '| --- | --- | --- |',
    ...apps.map((app) => {
      const versions = Object.entries(app.versions ?? {})
        .map(([name, version]) => `${name} ${version}`)
        .join(', ');
      return `| ${app.app} | ${app.framework} | ${versions || 'n/a'} |`;
    }),
  ].join('\n');
}

function postureTable(apps) {
  return [
    '| App | NODE_ENV | Deployment attestation |',
    '| --- | --- | --- |',
    ...apps.map(
      (app) =>
        `| ${app.app} | ${app.posture?.nodeEnv ?? '**not set**'} | ${app.posture?.attestation ?? 'n/a'} |`,
    ),
  ].join('\n');
}

function metricTable(apps, condition) {
  const rows = [
    `### ${title(condition)}`,
    '',
    '| App | TTFB ms | FCP ms | LCP ms | TBT ms | JS bytes | Total bytes | TTI proxy ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const app of apps) {
    const scenarios = app.conditions?.[condition] ?? {};
    const cold = scenarios.coldLoad?.summary ?? {};
    const tti = scenarios.ttiProbe?.summary ?? {};
    rows.push(
      [
        `| ${app.app}`,
        withSpread(cold['ttfbMs']),
        withSpread(cold['fcpMs']),
        withSpread(cold['lcpMs']),
        withSpread(cold['tbtMs']),
        format(cold['bytes.js']?.median),
        format(cold['bytes.total']?.median),
        withSpread(tti['ttiProxyMs']),
      ].join(' | ') + ' |',
    );
  }

  return rows.join('\n');
}

function byteWindowTable(apps, condition) {
  const rows = [
    `### ${title(condition)}`,
    '',
    '| App | Total (settled) | Total (load+150ms) | Understatement | JS (settled) | JS (load+150ms) | Settle ms | Capped runs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const app of apps) {
    const scenario = app.conditions?.[condition]?.coldLoad ?? {};
    const cold = scenario.summary ?? {};
    const capped = (scenario.iterations ?? []).filter(
      (iteration) => iteration.settleTimedOut === 1,
    ).length;
    const settledTotal = cold['bytes.total']?.median;
    const windowTotal = cold['loadWindow.bytes.total']?.median;
    const ratio =
      typeof settledTotal === 'number' && typeof windowTotal === 'number' && windowTotal > 0
        ? `${(settledTotal / windowTotal).toFixed(2)}x`
        : 'n/a';
    rows.push(
      [
        `| ${app.app}`,
        format(settledTotal),
        format(windowTotal),
        ratio,
        format(cold['bytes.js']?.median),
        format(cold['loadWindow.bytes.js']?.median),
        format(cold['settleMs']?.median),
        capped === 0 ? '0' : `**${capped}/${(scenario.iterations ?? []).length}**`,
      ].join(' | ') + ' |',
    );
  }
  return rows.join('\n');
}

function navigationTable(apps, condition) {
  const rows = [
    `### ${title(condition)}`,
    '',
    '| App | Nav to paint ms | Nav to destination DOM ms | Superseded probe ms | Superseded error | Doc replaced | Nav bytes | Nav requests |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const app of apps) {
    const scenario = app.conditions?.[condition]?.navigation ?? {};
    const nav = scenario.summary ?? {};
    const iterations = scenario.iterations ?? [];
    const paint = nav['navToPaintMs']?.median;
    const legacy = nav['navLegacyDomPresenceMs']?.median;
    const ratio =
      typeof paint === 'number' && typeof legacy === 'number' && legacy > 0
        ? `${(paint / legacy).toFixed(1)}x low`
        : 'n/a';
    const replaced = iterations.filter((iteration) => iteration.navDocumentReplaced === 1).length;
    rows.push(
      [
        `| ${app.app}`,
        withSpread(nav['navToPaintMs']),
        format(nav['navToDomMs']?.median),
        format(legacy),
        ratio,
        iterations.length === 0
          ? 'n/a'
          : replaced === iterations.length
            ? `**${replaced}/${iterations.length}**`
            : `${replaced}/${iterations.length}`,
        format(nav['navBytesSettled']?.median),
        format(nav['navRequests']?.median),
      ].join(' | ') + ' |',
    );
  }
  return rows.join('\n');
}

function bfcacheTable(apps) {
  const rows = [
    'The back/forward cache only exists for cross-document history traversal. A framework whose in-app navigation stays in one document has no bfcache entry to restore, so it is reported as `n/a (same-document)` rather than scored as a non-restore.',
    '',
    '| App | Restored | Applicable runs | Browser | Not-restored reasons |',
    '| --- | ---: | ---: | --- | --- |',
  ];
  for (const app of apps) {
    const probe = app.bfcache;
    if (!probe || probe.available === false) {
      rows.push(
        `| ${app.app} | not measured | n/a | n/a | ${probe?.unavailableReason ?? 'probe did not run'} |`,
      );
      continue;
    }
    const reasons = probe.notRestoredReasons ?? [];
    const applicable = probe.applicableCount ?? 0;
    rows.push(
      [
        `| ${app.app}`,
        applicable === 0 ? 'n/a (same-document)' : `${probe.restoredCount}/${applicable}`,
        `${applicable}/${probe.iterations.length}`,
        probe.browser ?? 'n/a',
        reasons.length === 0 ? 'none reported' : reasons.join(', '),
      ].join(' | ') + ' |',
    );
  }
  return rows.join('\n');
}

function lighthouseTable(apps) {
  const rows = [
    '| App | Form factor | Path | Perf (spread) | FCP ms | LCP ms | TBT ms | TTI ms | Bytes | Null samples |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const app of apps) {
    for (const run of app.lighthouse ?? []) {
      const nulls = Object.values(run.nullSamples ?? {}).reduce(
        (sum, value) => sum + (value ?? 0),
        0,
      );
      rows.push(
        [
          `| ${app.app}`,
          run.formFactor,
          run.path,
          scoreWithSpread(run),
          format(run.metrics.fcpMs),
          format(run.metrics.lcpMs),
          format(run.metrics.tbtMs),
          format(run.metrics.ttiMs),
          format(run.metrics.bytes),
          nulls === 0 ? '0' : `**${nulls}**`,
        ].join(' | ') + ' |',
      );
    }
  }
  return rows.join('\n');
}

function scoreWithSpread(run) {
  const median = run.metrics?.performanceScore;
  const spread = run.spread?.performanceScore;
  if (typeof median !== 'number') return 'n/a';
  const scaled = Math.round(median * 100);
  if (typeof spread !== 'number') return String(scaled);
  return `${scaled} (±${Math.round(spread * 100)})`;
}

function withSpread(entry) {
  if (!entry || typeof entry.median !== 'number') return 'n/a';
  if (typeof entry.mad !== 'number') return format(entry.median);
  return `${format(entry.median)} (${format(entry.mad)})`;
}

function title(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function format(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return String(Math.round(value));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // No default results path. `benchmarks/results/` deliberately holds no committed run (see
  // benchmarks/results/README.md), so the old `../results/results.json` default could only ever
  // resolve to a file that is not there — `pnpm run report` failed on ENOENT every single time.
  const resultsPath = process.argv[2];
  if (!resultsPath) {
    process.stderr.write(
      'Usage: node report.mjs <results.json> [report.md]\n' +
        '       pnpm run report -- /tmp/kovo-bench/results.json\n' +
        '\n' +
        'Point this at the --out-dir of an actual run. There is no default: benchmarks/results/\n' +
        'holds no committed run by design (benchmarks/results/README.md).\n',
    );
    process.exit(1);
  }
  await writeReport(
    resultsPath,
    process.argv[3] ?? path.join(path.dirname(resultsPath), 'report.md'),
  );
}
