import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildCard } from './cards.mjs';
import { traceGraph } from './graph-model.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../examples/devtool/data/${name}.json`, import.meta.url)),
      'utf8',
    ),
  );

describe.each(['commerce', 'crm', 'stackoverflow'])('committed %s devtool graph fixture', (app) => {
  it('has stable unique graph identities and closed edge endpoints', () => {
    const bundle = fixture(app);
    const nodeIds = new Set(bundle.nodes.map((node) => node.id));
    const edgeIds = new Set(bundle.edges.map((edge) => edge.id));

    expect(bundle.app).toBe(app);
    expect(nodeIds.size).toBe(bundle.nodes.length);
    expect(edgeIds.size).toBe(bundle.edges.length);
    expect(bundle.nodes.every((node) => node.id === `${node.kind}:${node.name}`)).toBe(true);
    expect(bundle.edges.every((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))).toBe(true);
    const observedCounts = {};
    for (const node of bundle.nodes) {
      observedCounts[node.kind] = (observedCounts[node.kind] ?? 0) + 1;
    }
    expect(observedCounts).toEqual(bundle.counts);
  });

  it('derives every card relationship from the same rendered edge set', () => {
    const bundle = fixture(app);
    for (const node of bundle.nodes) {
      const sections = buildCard(node, bundle).sections;
      const incoming = (kind) =>
        bundle.edges.filter((edge) => edge.kind === kind && edge.to === node.id);
      const outgoing = (kind) =>
        bundle.edges.filter((edge) => edge.kind === kind && edge.from === node.id);

      if (node.kind === 'component') {
        expect(sections.queriesIn.map((query) => query.id).sort()).toEqual(
          incoming('feeds')
            .map((edge) => edge.from)
            .sort(),
        );
        expect(sections.mutationsOut.map((mutation) => mutation.id).sort()).toEqual(
          outgoing('emits')
            .map((edge) => edge.to)
            .sort(),
        );
        const trace = traceGraph(bundle.nodes, bundle.edges, node.id);
        for (const edge of [...incoming('feeds'), ...outgoing('emits')]) {
          expect(trace.edges.has(edge.id)).toBe(true);
        }
      }
      if (node.kind === 'query') {
        expect(sections.feeds.map((component) => component.id).sort()).toEqual(
          outgoing('feeds')
            .map((edge) => edge.to)
            .sort(),
        );
      }
      if (node.kind === 'mutation') {
        expect(sections.writes.map((domain) => domain.id).sort()).toEqual(
          outgoing('writes')
            .map((edge) => edge.to)
            .sort(),
        );
      }
    }
  });
});
