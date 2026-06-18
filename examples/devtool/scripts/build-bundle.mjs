#!/usr/bin/env node
// Build-time: read each example's generated/graph.json, derive the DataflowGraph,
// resolve a real source slice for every node (Layer 2), and emit a ready-to-render
// bundle the Kovo app loads at request time. No deps — fs + the pure graph-model.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { buildDataflowGraph } from '../src/graph-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..'); // repo root
const OUT = resolve(__dirname, '../data');
mkdirSync(OUT, { recursive: true });

const APPS = [
  { id: 'commerce', label: 'Commerce', blurb: 'cart · products · orders' },
  { id: 'crm', label: 'CRM', blurb: 'contacts · deals · pipeline' },
  { id: 'stackoverflow', label: 'Stack Overflow', blurb: 'questions · answers · votes' },
];

const manifest = [];
for (const app of APPS) {
  const graphPath = join(ROOT, 'examples', app.id, 'src', 'generated', 'graph.json');
  if (!existsSync(graphPath)) { console.warn('skip', app.id); continue; }
  const raw = JSON.parse(readFileSync(graphPath, 'utf8'));
  const graph = buildDataflowGraph(raw);

  const srcRoot = join(ROOT, 'examples', app.id, 'src');
  const files = listSources(srcRoot);
  for (const node of graph.nodes) node.source = resolveSource(node, srcRoot, files);

  const bundle = { app: app.id, label: app.label, blurb: app.blurb, nodes: graph.nodes, edges: graph.edges, counts: countKinds(graph.nodes) };
  writeFileSync(join(OUT, `${app.id}.json`), JSON.stringify(bundle));
  manifest.push({ ...app, counts: bundle.counts });
  console.log(`✓ ${app.id}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`✓ manifest: ${manifest.length} apps`);

function resolveSource(node, srcRoot, files) {
  const d = node.data;
  try {
    if (node.kind === 'component') {
      const file = files.find((f) => f.endsWith(`/${d.domName}.tsx`)) || files.find((f) => f.endsWith(`/${d.domName}.ts`));
      if (file) return block(file, srcRoot, (l) => l.includes(`export const ${d.exportName}`) || l.includes('component('));
    }
    if (node.kind === 'query') {
      for (const f of files) {
        const s = block(f, srcRoot, (l) => l.includes(`query('${node.name}'`) || l.includes(`query("${node.name}"`));
        if (s) return s;
      }
    }
    if (node.kind === 'mutation') {
      const isDef = (l) => /mutation\s*\(/.test(l) && (l.includes(`'${node.name}'`) || l.includes(`"${node.name}"`));
      for (const f of files) {
        const s = block(f, srcRoot, isDef);
        if (s) { s.touches = (d.touch?.touches ?? []).map((t) => ({ ...t })); return s; }
      }
    }
    if (node.kind === 'domain') {
      for (const f of files) {
        const s = block(f, srcRoot, (l) => l.includes(`domain('${node.name}'`) || (l.includes('pgTable(') && l.includes(`'${node.name}`)));
        if (s) return s;
      }
    }
    if (node.kind === 'page') {
      for (const f of files) {
        const s = block(f, srcRoot, (l) => l.includes(`route('${node.name}'`) || l.includes(`route("${node.name}"`));
        if (s) return s;
      }
    }
  } catch { /* best-effort */ }
  return null;
}

function block(absFile, srcRoot, pred) {
  const text = readFileSync(absFile, 'utf8');
  const lines = text.split('\n');
  let start = lines.findIndex((l) => pred(l));
  if (start < 0) return null;
  const anchor = start;
  while (start > 0 && /^\s*(\/\/|\/\*|\*|@)/.test(lines[start - 1])) start--;
  let end = anchor, depth = 0, seen = false;
  for (let i = anchor; i < lines.length && i < anchor + 40; i++) {
    for (const ch of lines[i]) {
      if (ch === '(' || ch === '{' || ch === '[') { depth++; seen = true; }
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
    }
    end = i;
    if (seen && depth <= 0 && /[;)]\s*$/.test(lines[i])) break;
  }
  return {
    file: relative(srcRoot, absFile),
    startLine: start + 1, anchorLine: anchor + 1, endLine: end + 1,
    code: lines.slice(start, end + 1).join('\n'),
    lang: absFile.endsWith('.tsx') ? 'tsx' : 'ts',
  };
}

function listSources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'generated' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listSources(p, acc);
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('.test.')) acc.push(p);
  }
  return acc;
}

function countKinds(nodes) {
  const c = {};
  for (const n of nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
  return c;
}
