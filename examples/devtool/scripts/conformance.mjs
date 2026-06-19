#!/usr/bin/env node
// Same-artifact conformance (SPEC §5.3): the MCP card facts must equal the graph
// edges the visual UI renders from. Both derive from one bundle via the package's
// shared rules, so the agent surface and the human surface can't drift.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBundle, buildCard } from '@kovojs/devtool';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, '..', '..');
const APPS = ['commerce', 'crm', 'stackoverflow'];

const bundles = APPS.flatMap((app) => {
  const gp = join(EXAMPLES, app, 'src', 'generated', 'graph.json');
  if (!existsSync(gp)) return [];
  return [
    buildBundle({
      app,
      graph: JSON.parse(readFileSync(gp, 'utf8')),
      srcRoot: join(EXAMPLES, app, 'src'),
    }),
  ];
});

let failures = 0;
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const eq = (a, b, msg) => {
  const A = JSON.stringify([...a].sort(cmp)),
    B = JSON.stringify([...b].sort(cmp));
  if (A !== B) {
    console.error(`  ✗ ${msg}\n    card: ${A}\n    edges:${B}`);
    failures++;
  }
};

for (const bundle of bundles) {
  for (const node of bundle.nodes) {
    const S = buildCard(node, bundle).sections;
    const inEdges = (k) =>
      bundle.edges.filter((e) => e.kind === k && e.to === node.id).map((e) => e.from);
    const outEdges = (k) =>
      bundle.edges.filter((e) => e.kind === k && e.from === node.id).map((e) => e.to);
    if (node.kind === 'component') {
      eq(
        S.queriesIn.map((q) => q.id),
        inEdges('feeds'),
        `${bundle.app}/${node.label}: queriesIn ≡ feeds`,
      );
      eq(
        S.mutationsOut.map((m) => m.id),
        outEdges('emits'),
        `${bundle.app}/${node.label}: mutationsOut ≡ emits`,
      );
    }
    if (node.kind === 'query')
      eq(
        S.feeds.map((c) => c.id),
        outEdges('feeds'),
        `${bundle.app}/${node.label}: feeds`,
      );
    if (node.kind === 'mutation')
      eq(
        S.writes.map((d) => d.id),
        outEdges('writes'),
        `${bundle.app}/${node.label}: writes`,
      );
  }
}

if (failures) {
  console.error(`\n${failures} conformance failure(s).`);
  process.exit(1);
}
console.log(`✓ same-artifact conformance: MCP cards ≡ graph edges across ${bundles.length} apps.`);
