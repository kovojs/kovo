#!/usr/bin/env node
import { runLighthouse } from './lighthouse.mjs';
import { runScenarios } from './scenarios.mjs';

export async function runAppBenchmark({ app, iterations = 10, lighthouse = true, origin }) {
  const result = {
    app: app.id,
    framework: app.framework,
    origin,
    versions: app.versions ?? {},
    conditions: {},
    lighthouse: [],
  };

  for (const conditionName of ['desktop', 'mobile']) {
    result.conditions[conditionName] = await runScenarios({
      app,
      conditionName,
      iterations,
      origin,
    });
  }

  if (lighthouse) {
    result.lighthouse = await runLighthouse(origin);
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
