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
    'Each app renders the same 24-product catalog and serves the same WebP assets, listing route, and product-detail route. The cart implementations are intentionally not capability-matched: Kovo uses a platform-native L0 popover whose confirmation text is already present, while the React entrants implement hydrated client cart state. The custom harness uses fresh browser contexts, Chromium CDP throttling for the mobile profile, request-size accounting to network quiescence, a cart-dialog readiness proxy, a navigation-to-paint probe, and a back/forward-cache probe. Lighthouse runs cover the listing and one product detail page for desktop and mobile presets.',
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
    'Measured from the click to the first traced compositor/paint frame after a MutationObserver sees the destination marker. The same Chrome trace boundary is used whether navigation replaces the document or morphs it in place. `Doc replaced` counts navigations that destroyed the JS realm.',
    '',
    '`Superseded probe` reproduces the previous harness metric — wait for `main h1` to exist, then stop. The listing page also has a `main h1`, so that selector is already satisfied by the ORIGIN document and the probe resolves before the navigation commits: it measured harness round-trip latency, not navigation. `Superseded error` is how far low it lands. Do not quote it.',
    '',
    navigationTable(data.apps, 'desktop'),
    '',
    navigationTable(data.apps, 'mobile'),
    '',
    '## Navigation attribution',
    '',
    'Server and transfer come from the selected click-window navigation response. Browser-parser construction, style, layout, and paint are named Chrome timeline events. `Unsupported` means Chromium does not expose a stable cross-framework boundary; it never means zero. `Unattributed` is the directly measured response-end-to-destination-marker envelope left after trace-native work, and may contain decode/read, document building or morphing, and main-thread queueing.',
    '',
    navigationAttributionTable(data.apps, 'desktop'),
    '',
    navigationAttributionTable(data.apps, 'mobile'),
    '',
    navigationAttributionNotes(data.apps),
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
    // The integrity gate rejects a run whose Lighthouse traffic was shed or errored, but a cell
    // whose statuses could not be READ passes it with only a stderr note. Say so in the report,
    // where the number is quoted, rather than only in a log nobody keeps.
    untrackedTrafficNote(data.apps),
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
    '- **The destination-paint mark observes DOM readiness, then the trace selects the first later frame.** MutationObserver scheduling and compositor event availability can add a small common delay. Raw trace-derived samples and the destination-DOM column remain in the report so that delay is visible; the old asymmetric FCP-versus-two-rAF branch has been removed.',
    '- **Attribution rows are evidence, not an additive synthetic waterfall.** Request timing and Chrome timeline events can overlap. Response read/decode and DOM morph/apply remain `unsupported` unless Chromium supplies a direct boundary; their time is retained in the unattributed client envelope instead of guessed from residual arithmetic.',
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
  const source = data.source;
  const sourceSummary = source
    ? ` Source ${source.commit ?? 'unknown'} (${source.dirty ? `dirty: ${(source.dirtyPaths ?? []).join(', ') || 'paths not recorded'}` : 'clean'}). Lock digests: ${
        Object.entries(source.locks ?? {})
          .map(([name, digest]) => `${name}=${digest ?? 'missing'}`)
          .join(', ') || 'not recorded'
      }.`
    : ' Source commit, dirty state, and lock digests were not recorded.';
  return [
    `Run \`${data.runId ?? 'unknown'}\` on ${machine.platform}/${machine.arch}, ${machine.cpus} cores, `,
    `${(machine.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB, node ${machine.node}. `,
    `Load average at end of run (1/5/15 min): **${load}**.`,
    sourceSummary,
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

function navigationAttributionTable(apps, condition) {
  const phases = [
    ['Server', 'server'],
    ['Transfer', 'transfer'],
    ['Read/decode', 'responseReadDecode'],
    ['Document construct', 'documentConstruction'],
    ['DOM morph/apply', 'domMorphApply'],
    ['Style', 'style'],
    ['Layout', 'layout'],
    ['Paint', 'paint'],
    ['Unattributed', 'unattributed'],
  ];
  const rows = [
    `### ${title(condition)}`,
    '',
    `| App | Primary response | ${phases.map(([label]) => `${label} ms`).join(' | ')} |`,
    `| --- | --- | ${phases.map(() => '---:').join(' | ')} |`,
  ];
  for (const app of apps) {
    const scenario = app.conditions?.[condition]?.navigation ?? {};
    const iterations = scenario.iterations ?? [];
    const selections = [
      ...new Set(
        iterations.map((iteration) => {
          const response = iteration.navAttribution?.primaryResponse;
          return response?.status === 'observed'
            ? response.selection
            : response?.status === 'unsupported'
              ? 'not observed'
              : 'not measured';
        }),
      ),
    ];
    rows.push(
      `| ${app.app} | ${selections.length === 0 ? 'not measured' : selections.join(', ')} | ${phases
        .map(([, key]) => attributionPhaseCell(scenario, key))
        .join(' | ')} |`,
    );
  }
  return rows.join('\n');
}

function attributionPhaseCell(scenario, phaseName) {
  const iterations = scenario.iterations ?? [];
  const phases = iterations
    .map((iteration) => iteration.navAttribution?.phases?.[phaseName])
    .filter(Boolean);
  if (phases.length === 0) return 'not measured';
  const observed = phases.filter(
    (phase) => phase.status === 'observed' && Number.isFinite(phase.durationMs),
  );
  if (observed.length === 0) return 'unsupported';
  const aggregate = scenario.summary?.[`navAttribution.phases.${phaseName}.durationMs`];
  const value = withSpread(aggregate);
  return observed.length === phases.length
    ? value
    : `${value} (${observed.length}/${phases.length})`;
}

function navigationAttributionNotes(apps) {
  const notes = [];
  for (const app of apps) {
    for (const condition of ['desktop', 'mobile']) {
      const iterations = app.conditions?.[condition]?.navigation?.iterations ?? [];
      for (const iteration of iterations) {
        const response = iteration.navAttribution?.primaryResponse;
        if (response?.status === 'unsupported') {
          notes.push(`${app.app}/${condition}/primary response: ${response.reason}`);
        }
        for (const [phaseName, phase] of Object.entries(iteration.navAttribution?.phases ?? {})) {
          if (phase?.status === 'unsupported') {
            notes.push(`${app.app}/${condition}/${phaseName}: ${phase.reason}`);
          }
        }
      }
    }
  }
  const unique = [...new Set(notes)].sort();
  if (unique.length === 0) {
    return '_Every requested attribution phase was directly observed in this run._';
  }
  return [
    '**Unsupported or unattributed boundaries (deduplicated):**',
    '',
    ...unique.map((note) => `- ${note}`),
  ].join('\n');
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

/**
 * Names every probe whose HTTP statuses the run could not observe.
 *
 * "No errors reported" and "errors could not be reported" are different claims and the report must
 * not collapse them: the integrity gate only rejects statuses it can see.
 */
function untrackedTrafficNote(apps) {
  const untracked = [];
  for (const app of apps) {
    for (const cell of app.lighthouse ?? []) {
      if (cell.network?.tracked !== true) {
        const samples = cell.network?.untrackedSamples;
        untracked.push(
          `${app.app} lighthouse ${cell.formFactor}${cell.path}` +
            (typeof samples === 'number' ? ` (${samples}/${cell.repeats} samples)` : ''),
        );
      }
    }
    const bfcacheUntracked = (app.bfcache?.iterations ?? []).filter(
      (iteration) => !iteration.network,
    ).length;
    if (bfcacheUntracked > 0) {
      untracked.push(
        `${app.app} bfcache probe (${bfcacheUntracked}/${app.bfcache.iterations.length} iterations)`,
      );
    }
  }
  const faviconMisses = apps.reduce(
    (sum, app) =>
      sum +
      (app.lighthouse ?? []).reduce((cell, run) => cell + (run.network?.faviconMisses ?? 0), 0),
    0,
  );
  // Exempt from the >=400 gate but never hidden: see `isFaviconProbe` in harness/lighthouse.mjs.
  const faviconNote =
    faviconMisses === 0
      ? ''
      : `\n\n_${faviconMisses} \`GET /favicon.ico\` 404s across the Lighthouse cells. No entrant ships a favicon and no document references one; the browser asks on its own. Counted here, exempt from the >=400 gate, and included in the Lighthouse byte totals._`;

  if (untracked.length === 0) {
    return `_HTTP statuses were observed for every probe in this run, so the integrity gate saw all of its traffic._${faviconNote}`;
  }
  return (
    [
      '**HTTP statuses could not be observed for some probes in this run.** The integrity gate only',
      'rejects load shedding and errors it can see, so these numbers were NOT status-checked:',
      '',
      ...untracked.map((entry) => `- ${entry}`),
    ].join('\n') + faviconNote
  );
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
