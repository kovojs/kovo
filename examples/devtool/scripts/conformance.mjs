#!/usr/bin/env node
// Same-artifact conformance (SPEC §5.3): the MCP card facts must equal the graph
// edges the visual UI renders from. Both derive from one bundle via shared rules,
// so this asserts the agent surface and the human surface can never drift.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCard } from '../src/cards.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
let failures = 0;
const eq = (a, b, msg) => { const A = JSON.stringify([...a].sort()), B = JSON.stringify([...b].sort()); if (A !== B) { console.error(`  ✗ ${msg}\n    card: ${A}\n    edges:${B}`); failures++; } };

for (const f of readdirSync(DATA)) {
  if (!f.endsWith('.json') || f === 'manifest.json') continue;
  const bundle = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
  for (const node of bundle.nodes) {
    const card = buildCard(node, bundle);
    const S = card.sections;
    const inEdges = (kind) => bundle.edges.filter((e) => e.kind === kind && e.to === node.id).map((e) => e.from);
    const outEdges = (kind) => bundle.edges.filter((e) => e.kind === kind && e.from === node.id).map((e) => e.to);
    if (node.kind === 'component') {
      eq(S.queriesIn.map((q) => q.id), inEdges('feeds'), `${bundle.app}/${node.label}: queriesIn ≡ feeds edges`);
      eq(S.mutationsOut.map((m) => m.id), outEdges('emits'), `${bundle.app}/${node.label}: mutationsOut ≡ emits edges`);
    }
    if (node.kind === 'query') eq(S.feeds.map((c) => c.id), outEdges('feeds'), `${bundle.app}/${node.label}: feeds ≡ feeds edges`);
    if (node.kind === 'mutation') eq(S.writes.map((d) => d.id), outEdges('writes'), `${bundle.app}/${node.label}: writes ≡ writes edges`);
  }
}

if (failures) { console.error(`\n${failures} conformance failure(s).`); process.exit(1); }
console.log('✓ same-artifact conformance: MCP cards ≡ graph edges across all apps.');
