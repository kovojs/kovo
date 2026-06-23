#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

export async function writeReport(resultsPath, reportPath) {
  const data = JSON.parse(await readFile(resultsPath, 'utf8'));
  const lines = [
    '# Benchmark Report',
    '',
    `Generated: ${data.generatedAt}`,
    '',
    '## Methodology',
    '',
    'Each app renders the same 24-product catalog, serves the same WebP assets, and exposes the same listing, product detail, cart dialog, and checkout confirmation flow. The custom harness uses fresh browser contexts, cache-cleared runs, Chromium CDP throttling for the mobile profile, request-size accounting, a cart-dialog TTI proxy, and a navigation probe. Lighthouse runs cover the listing and one product detail page for desktop and mobile presets.',
    '',
    'The headline comparison is architectural, not a claim that one implementation is the only possible tuning for each framework: Kovo is measured as a server-rendered MPA with a platform-native L0 cart dialog and no hydration, while Next.js App Router and TanStack Start are measured with hydrated client cart UI. All apps use plain `<img>` tags to isolate framework behavior from image optimizer behavior.',
    '',
    '## Versions',
    '',
    versionTable(data.apps),
    '',
    '## Custom Harness Medians',
    '',
    metricTable(data.apps, 'desktop'),
    '',
    metricTable(data.apps, 'mobile'),
    '',
    '## Lighthouse',
    '',
    lighthouseTable(data.apps),
    '',
    '## Conditions',
    '',
    '- Desktop: Chromium, 1440x900 viewport, no CPU or network throttling.',
    '- Mobile: Chromium, 390x844 viewport, 4x CPU throttle, about 1.6 Mbps down / 750 Kbps up / 150 ms RTT.',
    `- Iterations per app, condition, and custom scenario: ${data.iterations}.`,
    '',
  ];

  await writeFile(reportPath, `${lines.join('\n')}\n`);
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

function metricTable(apps, condition) {
  const rows = [
    `### ${condition[0].toUpperCase()}${condition.slice(1)}`,
    '',
    '| App | FCP ms | LCP ms | TBT ms | JS bytes | Total bytes | TTI proxy ms | Nav detail ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const app of apps) {
    const scenarios = app.conditions?.[condition] ?? {};
    const cold = scenarios.coldLoad?.summary ?? {};
    const tti = scenarios.ttiProbe?.summary ?? {};
    const nav = scenarios.navigation?.summary ?? {};
    rows.push(
      [
        `| ${app.app}`,
        format(cold['fcpMs']?.median),
        format(cold['lcpMs']?.median),
        format(cold['tbtMs']?.median),
        format(cold['bytes.js']?.median),
        format(cold['bytes.total']?.median),
        format(tti['ttiProxyMs']?.median),
        format(nav['navToDetailMs']?.median),
      ].join(' | ') + ' |',
    );
  }

  return rows.join('\n');
}

function lighthouseTable(apps) {
  const rows = [
    '| App | Form factor | Path | Perf | FCP ms | LCP ms | TBT ms | TTI ms | Bytes |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const app of apps) {
    for (const run of app.lighthouse ?? []) {
      rows.push(
        [
          `| ${app.app}`,
          run.formFactor,
          run.path,
          format(run.metrics.performanceScore === null ? null : run.metrics.performanceScore * 100),
          format(run.metrics.fcpMs),
          format(run.metrics.lcpMs),
          format(run.metrics.tbtMs),
          format(run.metrics.ttiMs),
          format(run.metrics.bytes),
        ].join(' | ') + ' |',
      );
    }
  }
  return rows.join('\n');
}

function format(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return String(Math.round(value));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await writeReport(
    process.argv[2] ?? '../results/results.json',
    process.argv[3] ?? '../results/report.md',
  );
}
