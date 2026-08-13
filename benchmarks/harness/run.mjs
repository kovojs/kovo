#!/usr/bin/env node
import { readArg, readIntegerArg } from './args.mjs';
import { bfcacheIterationFindings, runBfcacheProbe } from './bfcache.mjs';
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
  warmups = 0,
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
      warmups,
    });
  }

  // Runs in its own bfcache-enabled full-Chromium process; see benchmarks/harness/bfcache.mjs.
  result.bfcache = await runBfcacheProbe({
    iterations: bfcacheIterations,
    listingPath: app.paths?.listing ?? '/',
    origin,
  });

  if (lighthouse) {
    result.lighthouse = await runLighthouse(origin, {
      listingPath: app.paths?.listing ?? '/',
      repeats: lighthouseRepeats,
    });
  }

  result.integrity = summarizeAppBenchmarkIntegrity(result, {
    bfcacheIterations,
    iterations,
    lighthouse,
    lighthouseRepeats,
    listingPath: app.paths?.listing ?? '/',
    scenarios: app.scenarios ?? ['coldLoad', 'ttiProbe', 'navigation'],
    warmups,
  });
  return result;
}

/**
 * Materialize the browser adapter's fail-closed integrity verdict in its own report. The serialized
 * comparison rechecks the underlying evidence, but it also requires this adapter-level verdict so
 * a future runner cannot silently omit a probe and still look like a complete browser cell.
 */
export function summarizeAppBenchmarkIntegrity(
  result,
  { bfcacheIterations, iterations, lighthouse, lighthouseRepeats, listingPath, scenarios, warmups },
) {
  const errors = [];
  const selectedScenarios = new Set(scenarios);
  for (const conditionName of ['desktop', 'mobile']) {
    const condition = result.conditions?.[conditionName];
    if (!condition) {
      errors.push(`${conditionName}: condition is absent`);
      continue;
    }
    for (const scenarioName of ['coldLoad', 'ttiProbe', 'navigation']) {
      const samples = condition[scenarioName]?.iterations;
      const expected = selectedScenarios.has(scenarioName) ? iterations : 0;
      if (!Array.isArray(samples) || samples.length !== expected) {
        errors.push(`${conditionName}/${scenarioName}: expected ${String(expected)} samples`);
        continue;
      }
      for (const [index, sample] of samples.entries()) {
        for (const field of [
          'errorResponses',
          'failedRequests',
          'pageErrors',
          'rateLimitedResponses',
        ]) {
          if (sample[field] !== 0) {
            errors.push(
              `${conditionName}/${scenarioName}[${String(index)}]: ${field} was not zero`,
            );
          }
        }
        const settleField = scenarioName === 'navigation' ? 'navSettleTimedOut' : 'settleTimedOut';
        if (sample[settleField] !== 0) {
          errors.push(
            `${conditionName}/${scenarioName}[${String(index)}]: ${settleField} was not zero`,
          );
        }
      }
    }
  }

  if (result.bfcache?.available !== true) {
    errors.push('bfcache: full Chromium probe was unavailable');
  } else if (result.bfcache.iterations?.length !== bfcacheIterations) {
    errors.push(`bfcache: expected ${String(bfcacheIterations)} samples`);
  }
  for (const [index, sample] of (result.bfcache?.iterations ?? []).entries()) {
    for (const finding of bfcacheIterationFindings(sample, { listingPath })) {
      errors.push(`bfcache[${String(index)}]: ${finding}`);
    }
    for (const field of [
      'errorResponses',
      'failedRequests',
      'pageErrors',
      'rateLimitedResponses',
    ]) {
      if (sample.network?.[field] !== 0) {
        errors.push(`bfcache[${String(index)}]: network.${field} was not zero`);
      }
    }
    if (!(sample.network?.requests > 0)) {
      errors.push(`bfcache[${String(index)}]: no responses were observed`);
    }
  }

  const expectedLighthouseCells = lighthouse ? 4 : 0;
  if (result.lighthouse?.length !== expectedLighthouseCells) {
    errors.push(`lighthouse: expected ${String(expectedLighthouseCells)} cells`);
  }
  for (const [index, cell] of (result.lighthouse ?? []).entries()) {
    if (cell.repeats !== lighthouseRepeats || cell.samples?.length !== lighthouseRepeats) {
      errors.push(`lighthouse[${String(index)}]: repeat policy mismatch`);
    }
    if (Object.values(cell.nullSamples ?? {}).some((value) => value !== 0)) {
      errors.push(`lighthouse[${String(index)}]: null metric samples were observed`);
    }
    if (Object.values(cell.metrics ?? {}).some((value) => !Number.isFinite(value))) {
      errors.push(`lighthouse[${String(index)}]: aggregate metric is absent`);
    }
    if (
      cell.network?.tracked !== true ||
      cell.network.errorResponses !== 0 ||
      cell.network.rateLimitedResponses !== 0
    ) {
      errors.push(`lighthouse[${String(index)}]: network integrity failed`);
    }
  }

  const uniqueErrors = [...new Set(errors)];
  return {
    complete: uniqueErrors.length === 0,
    errors: uniqueErrors,
    policy: {
      bfcacheIterations,
      iterations,
      lighthouseRepeats: lighthouse ? lighthouseRepeats : 0,
      listingPath,
      scenarios: [...selectedScenarios],
      warmups,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origin = readArg('--origin') || 'http://127.0.0.1:3000';
  const app = {
    framework: readArg('--framework') || 'manual',
    id: readArg('--app') || 'manual',
  };
  const iterations = readIntegerArg('--iterations', { fallback: 2, max: 1_000 });
  const result = await runAppBenchmark({ app, iterations, origin });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
