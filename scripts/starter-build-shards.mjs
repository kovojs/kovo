export const starterBuildShards = [
  {
    id: 'scaffold',
    label: 'scaffold and build graph',
    tests: [
      'typechecks the generated app with starter dependencies',
      'typechecks the generated SQLite app variant',
      'runs vp check in the generated SQLite app',
      'runs the generated in-app tests (data layer + request shell)',
      'runs the generated production build graph gate',
      'rebuilds production artifacts from current source when cache is warm',
    ],
  },
  {
    id: 'prod-artifact',
    label: 'production artifact gates',
    tests: [
      'serves non-empty enhanced add-contact truth from the production build artifact',
      'rejects no-JS add-contact idempotency token collisions from the production artifact',
      'blocks starter Better Auth credential projections from the production build artifact',
      'blocks raw owner-table db.execute writes from the production build artifact',
      'blocks undeclared raw db.execute writes from the production build artifact',
      'accepts trusted raw owner-table db.execute writes from the production build artifact',
      'serves component-scoped FormError as a real no-JS 422 output from the production artifact',
    ],
  },
  {
    id: 'runtime',
    label: 'runtime, assets, and dev server',
    tests: [
      'fingerprints the starter stylesheet URL before serving it as immutable',
      'boots Postgres starter DDL with serial columns, reordered foreign keys, and additive drift',
      'serves the generated app through vp dev (redirect + login + styles)',
      'honors HOST and PORT from the generated starter Vite config',
    ],
  },
];

export function starterBuildShard(id) {
  const shard = starterBuildShards.find((candidate) => candidate.id === id);
  if (!shard) {
    const validIds = starterBuildShards.map((candidate) => candidate.id).join(', ');
    throw new Error(`Unknown starter build shard "${id}". Expected one of: ${validIds}.`);
  }
  return shard;
}

export function starterBuildShardPattern(id) {
  return starterBuildShard(id).tests.map(escapeRegExp).join('|');
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command, shardId] = process.argv;
  if (command === 'pattern' && shardId) {
    process.stdout.write(`${starterBuildShardPattern(shardId)}\n`);
  } else if (command === 'list') {
    process.stdout.write(`${starterBuildShards.map((shard) => shard.id).join('\n')}\n`);
  } else {
    process.stderr.write(
      'Usage: node scripts/starter-build-shards.mjs pattern <shard-id>\n' +
        '       node scripts/starter-build-shards.mjs list\n',
    );
    process.exitCode = 1;
  }
}
