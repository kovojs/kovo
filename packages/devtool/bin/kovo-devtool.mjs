#!/usr/bin/env node
// kovo-devtool — CLI for the dataflow devtool's agent surface.
//
//   kovo-devtool mcp --graph <graph.json> --src <srcRoot> [--label <name>] ...
//
// Repeat --graph/--src/--label to expose several apps. Serves the kovo_explain
// MCP tool over stdio.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildBundle } from '../src/source-slice.mjs';
import { createMcpServer } from '../src/mcp.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];

function parseApps(args) {
  const apps = [];
  let cur = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--graph') {
      cur = { graph: args[++i] };
      apps.push(cur);
    } else if (a === '--src') {
      if (cur) cur.src = args[++i];
    } else if (a === '--label') {
      if (cur) cur.label = args[++i];
    } else if (a === '--blurb') {
      if (cur) cur.blurb = args[++i];
    }
  }
  return apps;
}

if (cmd === 'mcp') {
  const specs = parseApps(argv.slice(1));
  if (!specs.length) {
    console.error('usage: kovo-devtool mcp --graph <graph.json> --src <srcRoot> [--label name]');
    process.exit(1);
  }
  const bundles = specs.map((s) => {
    const graph = JSON.parse(readFileSync(s.graph, 'utf8'));
    const app = (s.label ?? basename(s.graph).replace(/\.json$/, ''))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    return buildBundle({
      app,
      label: s.label ?? app,
      blurb: s.blurb,
      graph,
      srcRoot: s.src ?? '.',
    });
  });
  await createMcpServer({ bundles }).serveStdio();
} else {
  console.error('usage: kovo-devtool mcp --graph <graph.json> --src <srcRoot> [--label name]');
  process.exit(1);
}
