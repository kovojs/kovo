import { spawnSync } from 'node:child_process';

const commands = [
  ['node', ['--test', 'tests/fw-check.node.mjs']],
  ['node', ['dist/cli/src/index.mjs', 'check', 'examples/commerce/src/generated/graph.json']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
