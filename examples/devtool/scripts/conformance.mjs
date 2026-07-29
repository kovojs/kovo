#!/usr/bin/env node
// Same-artifact conformance (SPEC §5.3): graph cards are the shared fact
// source for the visual inspector and MCP, and targeted `kovo explain` must
// report the same relationships. The committed bundles keep this proof
// runnable from a clean checkout without first generating app artifacts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCard } from '@kovojs/devtool';

const HERE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA = resolve(HERE, 'data');
const APPS = ['commerce', 'crm', 'stackoverflow'];

export function runConformance(kovoExplain) {
  if (typeof kovoExplain !== 'function') {
    throw new TypeError('runConformance requires the public @kovojs/cli kovoExplain function.');
  }
  const bundles = APPS.map((app) => JSON.parse(readFileSync(resolve(DATA, `${app}.json`), 'utf8')));
  const failures = [];
  const cmp = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  const eq = (left, right, message) => {
    const actual = JSON.stringify([...left].sort(cmp));
    const expected = JSON.stringify([...right].sort(cmp));
    if (actual !== expected) {
      failures.push(`${message}\n    card: ${actual}\n    peer: ${expected}`);
    }
  };

  for (const bundle of bundles) {
    const explainInput = explainInputFromBundle(bundle);
    for (const node of bundle.nodes) {
      const sections = buildCard(node, bundle).sections;
      const inEdges = (kind) =>
        bundle.edges.filter((edge) => edge.kind === kind && edge.to === node.id);
      const outEdges = (kind) =>
        bundle.edges.filter((edge) => edge.kind === kind && edge.from === node.id);

      if (node.kind === 'component') {
        eq(
          sections.queriesIn.map((query) => query.id),
          inEdges('feeds').map((edge) => edge.from),
          `${bundle.app}/${node.label}: card queriesIn ≡ UI feeds`,
        );
        eq(
          sections.mutationsOut.map((mutation) => mutation.id),
          outEdges('emits').map((edge) => edge.to),
          `${bundle.app}/${node.label}: card mutationsOut ≡ UI emits`,
        );
        const cli = kovoExplain(explainInput, { target: node.name, view: 'component' });
        eq(
          sections.queriesIn.map((query) => query.name),
          parseListLine(cli.output, 'queries: '),
          `${bundle.app}/${node.label}: card queriesIn ≡ CLI queries`,
        );
        eq(
          sections.mutationsOut.map((mutation) => mutation.name),
          parseFormMutations(cli.output),
          `${bundle.app}/${node.label}: card mutationsOut ≡ CLI forms`,
        );
      }
      if (node.kind === 'query') {
        eq(
          sections.feeds.map((component) => component.id),
          outEdges('feeds').map((edge) => edge.to),
          `${bundle.app}/${node.label}: card feeds ≡ UI feeds`,
        );
        const cli = kovoExplain(explainInput, { target: node.name, view: 'query' });
        eq(
          sections.reads.map((domain) => domain.name),
          parseListLine(cli.output, 'reads: '),
          `${bundle.app}/${node.label}: card reads ≡ CLI reads`,
        );
        eq(
          sections.feeds.map((component) => component.label),
          parseListLine(cli.output, 'consumers: ')
            .filter((consumer) => consumer.startsWith('component:'))
            .map((consumer) => consumer.slice('component:'.length)),
          `${bundle.app}/${node.label}: card feeds ≡ CLI consumers`,
        );
        eq(
          sections.invalidatedBy.map((mutation) => mutation.name),
          parseListLine(cli.output, 'invalidated-by: '),
          `${bundle.app}/${node.label}: card invalidators ≡ CLI invalidated-by`,
        );
      }
      if (node.kind === 'mutation') {
        eq(
          sections.writes.map((domain) => domain.id),
          outEdges('writes').map((edge) => edge.to),
          `${bundle.app}/${node.label}: card writes ≡ UI writes`,
        );
        const cli = kovoExplain(explainInput, { target: node.name, view: 'mutation' });
        eq(
          sections.writes.map((domain) => domain.name),
          parseListLine(cli.output, 'writes: '),
          `${bundle.app}/${node.label}: card writes ≡ CLI writes`,
        );
        eq(
          sections.invalidates.map((query) => query.name),
          bundle.nodes
            .filter((candidate) => candidate.kind === 'query')
            .filter((query) =>
              parseListLine(
                kovoExplain(explainInput, { target: query.name, view: 'query' }).output,
                'invalidated-by: ',
              ).includes(node.name),
            )
            .map((query) => query.name),
          `${bundle.app}/${node.label}: card invalidates ≡ CLI query invalidators`,
        );
      }
      if (node.kind === 'page') {
        const cli = kovoExplain(explainInput, {
          layouts: true,
          target: node.name,
          view: 'page',
        });
        eq(
          sections.renders.map((component) => component.label),
          parseSegmentComponents(cli.output),
          `${bundle.app}/${node.label}: card renders ≡ CLI navigation segment`,
        );
      }
    }
  }

  return { apps: bundles.length, failures };
}

function explainInputFromBundle(bundle) {
  const byId = new Map(bundle.nodes.map((node) => [node.id, node]));
  return {
    components: bundle.nodes
      .filter((node) => node.kind === 'component')
      .map((node) => ({
        domName: node.data.domName || undefined,
        exportName: node.label,
        fragments: node.data.fragments ?? [],
        mutationForms: bundle.edges
          .filter((edge) => edge.kind === 'emits' && edge.from === node.id)
          .map((edge) => ({
            fields: byId.get(edge.to)?.data.inputFields ?? [],
            mutation: byId.get(edge.to)?.name ?? edge.to.slice('mutation:'.length),
            slot: byId.get(edge.to)?.name ?? edge.to,
          })),
        name: node.name,
        queries: bundle.edges
          .filter((edge) => edge.kind === 'feeds' && edge.to === node.id)
          .map((edge) => byId.get(edge.from)?.name)
          .filter(Boolean),
      })),
    mutations: bundle.nodes
      .filter((node) => node.kind === 'mutation')
      .map((node) => ({
        guards: node.data.guards ?? [],
        inputFields: node.data.inputFields ?? [],
        invalidates: node.data.invalidates ?? node.data.writes ?? [],
        key: node.name,
        writes: node.data.writes ?? [],
      })),
    pages: bundle.nodes
      .filter((node) => node.kind === 'page')
      .map((node) => ({
        navigationSegments: [
          {
            components: bundle.edges
              .filter((edge) => edge.kind === 'renders' && edge.from === node.id)
              .map((edge) => byId.get(edge.to)?.label)
              .filter(Boolean),
            id: `page:${node.name}`,
            kind: 'page',
            name: node.name,
            queries: [],
          },
        ],
        queries: [],
        route: node.name,
      })),
    queries: bundle.nodes
      .filter((node) => node.kind === 'query')
      .map((node) => ({
        domains: node.data.domains ?? [],
        guards: node.data.guards ?? [],
        query: node.name,
      })),
  };
}

function parseListLine(output, prefix) {
  const line = output.split('\n').find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) return [];
  const value = line.slice(prefix.length);
  return value === '-' || value === '' ? [] : value.split(',');
}

function parseFormMutations(output) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('FORM '))
    .map((line) => /(?:^|\s)mutation=([^\s]+)/u.exec(line)?.[1])
    .filter(Boolean);
}

function parseSegmentComponents(output) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('segment: '))
    .flatMap((line) => {
      const value = /(?:^|\s)components=([^\s]+)/u.exec(line)?.[1];
      return value === undefined || value === '-' ? [] : value.split(',');
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The workspace CLI intentionally exposes TypeScript source. Direct Node
  // execution therefore asks Vite to load the public API exactly as the
  // workspace test runner does; packed consumers resolve the built module.
  const { createServer } = await import('vite');
  const vite = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    root: resolve(HERE, '../..'),
    server: { middlewareMode: true },
  });
  let result;
  try {
    const cli = await vite.ssrLoadModule('/packages/cli/src/api.ts');
    result = runConformance(cli.kovoExplain);
  } finally {
    await vite.close();
  }
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`  ✗ ${failure}`);
    console.error(`\n${result.failures.length} conformance failure(s).`);
    process.exitCode = 1;
  } else {
    console.log(
      `✓ same-artifact conformance: UI edges ≡ MCP graph cards ≡ CLI text across ${result.apps} apps.`,
    );
  }
}
