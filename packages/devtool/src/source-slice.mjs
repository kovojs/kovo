// Source-slice resolution (Layer 1): given a host app's KovoExplainInput and the
// root of its source tree, derive the DataflowGraph and attach a real source slice
// (file, line range, code, lang) to every node. fs-backed, so it runs at the
// host's build/startup, not inside the renderer.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildDataflowGraph } from './graph-model.mjs';

/**
 * @param {{ app: string, label?: string, blurb?: string, graph: any, srcRoot: string }} opts
 * @returns {{ app: string, label: string, blurb: string, nodes: any[], edges: any[], counts: Record<string, number> }}
 */
export function buildBundle({ app, label, blurb, graph, srcRoot }) {
  const g = buildDataflowGraph(graph);
  const files = listSources(srcRoot);
  for (const node of g.nodes) node.source = resolveSource(node, srcRoot, files);
  const counts = {};
  for (const n of g.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  return { app, label: label ?? app, blurb: blurb ?? '', nodes: g.nodes, edges: g.edges, counts };
}

export function resolveSource(node, srcRoot, files) {
  const d = node.data;
  try {
    if (node.kind === 'component') {
      const file =
        files.find((f) => f.endsWith(`/${d.domName}.tsx`)) ||
        files.find((f) => f.endsWith(`/${d.domName}.ts`));
      if (file)
        return block(
          file,
          srcRoot,
          (l) => l.includes(`export const ${d.exportName}`) || l.includes('component('),
        );
    }
    if (node.kind === 'query') {
      for (const f of files) {
        const s = block(
          f,
          srcRoot,
          (l) => l.includes(`query('${node.name}'`) || l.includes(`query("${node.name}"`),
        );
        if (s) return s;
      }
    }
    if (node.kind === 'mutation') {
      const isDef = (l) =>
        /mutation\s*\(/.test(l) && (l.includes(`'${node.name}'`) || l.includes(`"${node.name}"`));
      for (const f of files) {
        const s = block(f, srcRoot, isDef);
        if (s) {
          s.touches = (d.touch?.touches ?? []).map((t) => ({ ...t }));
          return s;
        }
      }
    }
    if (node.kind === 'domain') {
      for (const f of files) {
        const s = block(
          f,
          srcRoot,
          (l) =>
            l.includes(`domain('${node.name}'`) ||
            (l.includes('pgTable(') && l.includes(`'${node.name}`)),
        );
        if (s) return s;
      }
    }
    if (node.kind === 'page') {
      for (const f of files) {
        const s = block(
          f,
          srcRoot,
          (l) => l.includes(`route('${node.name}'`) || l.includes(`route("${node.name}"`),
        );
        if (s) return s;
      }
    }
  } catch {
    /* best-effort */
  }
  return null;
}

function block(absFile, srcRoot, pred) {
  const lines = readFileSync(absFile, 'utf8').split('\n');
  let start = lines.findIndex((l) => pred(l));
  if (start < 0) return null;
  const anchor = start;
  while (start > 0 && /^\s*(\/\/|\/\*|\*|@)/.test(lines[start - 1])) start--;
  let end = anchor,
    depth = 0,
    seen = false;
  for (let i = anchor; i < lines.length && i < anchor + 40; i++) {
    for (const ch of lines[i]) {
      if (ch === '(' || ch === '{' || ch === '[') {
        depth++;
        seen = true;
      } else if (ch === ')' || ch === '}' || ch === ']') depth--;
    }
    end = i;
    if (seen && depth <= 0 && /[;)]\s*$/.test(lines[i])) break;
  }
  return {
    file: relative(srcRoot, absFile),
    startLine: start + 1,
    anchorLine: anchor + 1,
    endLine: end + 1,
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
