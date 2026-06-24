import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { emitCommerceGraphArtifactsToTemp } from './commerce-graph.mjs';

export const cliEntry = 'dist/cli/src/index.mjs';
const suiteCommands = new Map([
  ['compiler-runtime', ['node', ['--test', 'tests/kovo-check.compiler-runtime.node.mjs']]],
  ['server-browser', ['node', ['--test', 'tests/kovo-check.server-browser.node.mjs']]],
  ['project', ['node', ['--test', 'tests/kovo-check.node.mjs']]],
  ['graph-cli', null],
]);
const defaultSuites = [...suiteCommands.keys()];

export function missingBuildMessage(entry = cliEntry) {
  return `kovo-check requires ${entry}. Run \`vp run build\` first.`;
}

function selectedSuitesFromArgs(args) {
  const suites = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--suite') {
      index += 1;
      suites.push(args[index]);
      continue;
    }
    if (arg?.startsWith('--suite=')) {
      suites.push(arg.slice('--suite='.length));
      continue;
    }
    suites.push(arg);
  }

  const selected = suites.length > 0 ? suites : defaultSuites;
  for (const suite of selected) {
    if (!suiteCommands.has(suite)) {
      console.error(`Unknown kovo-check suite: ${suite}`);
      console.error(`Known suites: ${defaultSuites.join(', ')}`);
      return null;
    }
  }
  return selected;
}

export function runKovoCheck({ entry = cliEntry, suites = defaultSuites } = {}) {
  if (!existsSync(entry)) {
    console.error(missingBuildMessage(entry));
    return 1;
  }

  const commands = [];
  let graphArtifacts;

  try {
    for (const suite of suites) {
      if (suite === 'graph-cli') {
        graphArtifacts ??= emitCommerceGraphArtifactsToTemp();
        commands.push(['node', [entry, 'check', graphArtifacts.graphPath]]);
        continue;
      }
      commands.push(suiteCommands.get(suite));
    }

    for (const [command, commandArgs] of commands) {
      const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
      if (result.status !== 0) {
        return result.status ?? 1;
      }
    }
  } finally {
    graphArtifacts?.cleanup();
  }

  return 0;
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (import.meta.url === entryPoint) {
  const suites = selectedSuitesFromArgs(process.argv.slice(2));
  process.exit(suites === null ? 1 : runKovoCheck({ suites }));
}
