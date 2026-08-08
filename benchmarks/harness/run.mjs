#!/usr/bin/env node
import { runBfcacheProbe } from './bfcache.mjs';
import { DEFAULT_LIGHTHOUSE_REPEATS, runLighthouse } from './lighthouse.mjs';
import { runScenarios } from './scenarios.mjs';

export async function runAppBenchmark({
  app,
  bfcacheIterations = 3,
  iterations = 10,
  lighthouse = true,
  lighthouseRepeats = DEFAULT_LIGHTHOUSE_REPEATS,
  origin,
  settle,
}) {
  const result = {
    app: app.id,
    framework: app.framework,
    origin,
    posture: app.posture ?? null,
    versions: app.versions ?? {},
    conditions: {},
    lighthouse: [],
    bfcache: null,
  };

  for (const conditionName of ['desktop', 'mobile']) {
    result.conditions[conditionName] = await runScenarios({
      app,
      conditionName,
      iterations,
      origin,
      settle,
    });
  }

  // Runs in its own bfcache-enabled full-Chromium process; see benchmarks/harness/bfcache.mjs.
  result.bfcache = await runBfcacheProbe({ iterations: bfcacheIterations, origin });

  if (lighthouse) {
    result.lighthouse = await runLighthouse(origin, { repeats: lighthouseRepeats });
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origin = readArg('--origin') ?? 'http://127.0.0.1:3000';
  const app = {
    framework: readArg('--framework') ?? 'manual',
    id: readArg('--app') ?? 'manual',
  };
  const iterations = Number(readArg('--iterations') ?? '2');
  const result = await runAppBenchmark({ app, iterations, origin });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
