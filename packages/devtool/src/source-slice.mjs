// Source-slice resolution (Layer 1): given a host app's KovoExplainInput and the
// root of its source tree, derive the DataflowGraph and attach a real source slice
// (file, line range, code, lang) to every node. fs-backed, so it runs at the
// host's build/startup, not inside the renderer.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import { buildDataflowGraph } from './graph-model.mjs';
import {
  arrayAppend,
  arrayLength,
  arrayValue,
  isArray,
  isSafeInteger,
  stringEndsWith,
  stringIncludes,
  stringStartsWith,
} from './output-security.mjs';

const FILE_TYPE_MASK = constants.S_IFMT;
const FILE_TYPE_DIRECTORY = constants.S_IFDIR;
const FILE_TYPE_REGULAR = constants.S_IFREG;
const FILE_TYPE_SYMLINK = constants.S_IFLNK;
const MAX_SOURCE_DEPTH = 128;
const MAX_SOURCE_ENTRIES = 200_000;
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const SOURCE_OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * @param {{ app: string, label?: string, blurb?: string, graph: any, srcRoot: string }} opts
 * @returns {{ app: string, label: string, blurb: string, nodes: any[], edges: any[], counts: Record<string, number> }}
 */
export function buildBundle({ app, label, blurb, graph, srcRoot }) {
  const g = buildDataflowGraph(graph);
  const canonicalSrcRoot = canonicalSourceRoot(srcRoot);
  const files = listSources(canonicalSrcRoot);
  for (const node of g.nodes) node.source = resolveSource(node, canonicalSrcRoot, files);
  const counts = {};
  for (const n of g.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  return { app, label: label ?? app, blurb: blurb ?? '', nodes: g.nodes, edges: g.edges, counts };
}

export function resolveSource(node, srcRoot, files) {
  try {
    const canonicalSrcRoot = canonicalSourceRoot(srcRoot);
    const sourceFiles = snapshotSourceFiles(files);
    const d = node.data;
    if (node.kind === 'component') {
      const file =
        findSourceFile(sourceFiles, (candidate) =>
          stringEndsWith(candidate, `/${d.domName}.tsx`),
        ) ||
        findSourceFile(sourceFiles, (candidate) => stringEndsWith(candidate, `/${d.domName}.ts`));
      if (file)
        return block(
          file,
          canonicalSrcRoot,
          (l) =>
            stringIncludes(l, `export const ${d.exportName}`) || stringIncludes(l, 'component('),
        );
    }
    if (node.kind === 'query') {
      for (let index = 0; index < arrayLength(sourceFiles, 'Devtool source files'); index += 1) {
        const f = arrayValue(sourceFiles, index, 'Devtool source files');
        const s = block(
          f,
          canonicalSrcRoot,
          (l) =>
            stringIncludes(l, `query('${node.name}'`) || stringIncludes(l, `query("${node.name}"`),
        );
        if (s) return s;
      }
    }
    if (node.kind === 'mutation') {
      const isDef = (l) =>
        /mutation\s*\(/.test(l) && (l.includes(`'${node.name}'`) || l.includes(`"${node.name}"`));
      for (let index = 0; index < arrayLength(sourceFiles, 'Devtool source files'); index += 1) {
        const f = arrayValue(sourceFiles, index, 'Devtool source files');
        const s = block(f, canonicalSrcRoot, isDef);
        if (s) {
          s.touches = (d.touch?.touches ?? []).map((t) => ({ ...t }));
          return s;
        }
      }
    }
    if (node.kind === 'domain') {
      for (let index = 0; index < arrayLength(sourceFiles, 'Devtool source files'); index += 1) {
        const f = arrayValue(sourceFiles, index, 'Devtool source files');
        const s = block(
          f,
          canonicalSrcRoot,
          (l) =>
            stringIncludes(l, `domain('${node.name}'`) ||
            (stringIncludes(l, 'pgTable(') && stringIncludes(l, `'${node.name}`)),
        );
        if (s) return s;
      }
    }
    if (node.kind === 'page') {
      for (let index = 0; index < arrayLength(sourceFiles, 'Devtool source files'); index += 1) {
        const f = arrayValue(sourceFiles, index, 'Devtool source files');
        const s = block(
          f,
          canonicalSrcRoot,
          (l) =>
            stringIncludes(l, `route('${node.name}'`) || stringIncludes(l, `route("${node.name}"`),
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
  const sourceFile = confinedSourceFile(absFile, srcRoot);
  if (!sourceFile) return null;
  const pinnedSourceFile = readPinnedSourceFile(sourceFile, srcRoot);
  if (!pinnedSourceFile) return null;
  const lines = pinnedSourceFile.code.split('\n');
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
    file: pinnedSourceFile.relative,
    startLine: start + 1,
    anchorLine: anchor + 1,
    endLine: end + 1,
    code: lines.slice(start, end + 1).join('\n'),
    lang: stringEndsWith(pinnedSourceFile.absolute, '.tsx') ? 'tsx' : 'ts',
  };
}

function listSources(dir, acc = [], state = { entries: 0 }, depth = 0) {
  if (depth > MAX_SOURCE_DEPTH) {
    throw new Error('Devtool source root exceeds the directory-depth budget.');
  }
  const names = readdirSync(dir);
  for (let index = 0; index < arrayLength(names, 'Devtool source directory'); index += 1) {
    const name = arrayValue(names, index, 'Devtool source directory');
    if (typeof name !== 'string')
      throw new TypeError('Devtool source entry names must be strings.');
    state.entries += 1;
    if (state.entries > MAX_SOURCE_ENTRIES) {
      throw new Error('Devtool source root exceeds the directory-entry budget.');
    }
    if (name === 'generated' || name === 'node_modules') continue;
    const p = join(dir, name);
    const mode = lstatSync(p).mode & FILE_TYPE_MASK;
    // SPEC §6.6 / §10.3 C9: source preview is a file-read sink. Never follow a
    // repository symlink outside the explicitly selected source root.
    if (mode === FILE_TYPE_SYMLINK) continue;
    if (mode === FILE_TYPE_DIRECTORY) listSources(p, acc, state, depth + 1);
    else if (
      mode === FILE_TYPE_REGULAR &&
      (stringEndsWith(p, '.ts') || stringEndsWith(p, '.tsx')) &&
      !stringIncludes(p, '.test.')
    ) {
      arrayAppend(acc, p, 'Devtool source files');
    }
  }
  return acc;
}

function canonicalSourceRoot(srcRoot) {
  if (typeof srcRoot !== 'string' || srcRoot.length === 0) {
    throw new TypeError('Devtool source root must be a non-empty path string.');
  }
  const canonical = realpathSync(srcRoot);
  if ((lstatSync(canonical).mode & FILE_TYPE_MASK) !== FILE_TYPE_DIRECTORY) {
    throw new TypeError('Devtool source root must resolve to a directory.');
  }
  return canonical;
}

function snapshotSourceFiles(files) {
  if (!isArray(files)) throw new TypeError('Devtool source files must be an array.');
  const length = arrayLength(files, 'Devtool source files');
  if (length > MAX_SOURCE_ENTRIES) {
    throw new TypeError('Devtool source files exceed the collection budget.');
  }
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const file = arrayValue(files, index, 'Devtool source files');
    if (typeof file !== 'string') {
      throw new TypeError(`Devtool source files[${index}] must be a string.`);
    }
    arrayAppend(snapshot, file, 'Devtool source files');
  }
  return snapshot;
}

function findSourceFile(files, predicate) {
  for (let index = 0; index < arrayLength(files, 'Devtool source files'); index += 1) {
    const file = arrayValue(files, index, 'Devtool source files');
    if (predicate(file)) return file;
  }
  return undefined;
}

function confinedSourceFile(file, srcRoot) {
  const direct = lstatSync(file);
  if ((direct.mode & FILE_TYPE_MASK) === FILE_TYPE_SYMLINK) return null;
  const absolute = realpathSync(file);
  const relativePath = confinedRelative(absolute, srcRoot);
  if (relativePath === null) return null;
  if (
    (!stringEndsWith(absolute, '.ts') && !stringEndsWith(absolute, '.tsx')) ||
    stringIncludes(absolute, '.test.')
  ) {
    return null;
  }
  const stat = lstatSync(absolute);
  if (
    (stat.mode & FILE_TYPE_MASK) !== FILE_TYPE_REGULAR ||
    !isSafeInteger(stat.size) ||
    stat.size < 0 ||
    stat.size > MAX_SOURCE_FILE_BYTES
  ) {
    return null;
  }
  return { absolute, relative: relativePath };
}

function readPinnedSourceFile(sourceFile, srcRoot) {
  const descriptor = openSync(sourceFile.absolute, SOURCE_OPEN_FLAGS);
  try {
    const absolute = realpathSync(sourceFile.absolute);
    const relativePath = confinedRelative(absolute, srcRoot);
    if (relativePath === null) return null;
    const pathStat = lstatSync(absolute);
    const descriptorStat = fstatSync(descriptor);
    if (
      !sameFileIdentity(pathStat, descriptorStat) ||
      (descriptorStat.mode & FILE_TYPE_MASK) !== FILE_TYPE_REGULAR ||
      !isSafeInteger(descriptorStat.size) ||
      descriptorStat.size < 0 ||
      descriptorStat.size > MAX_SOURCE_FILE_BYTES
    ) {
      return null;
    }
    return {
      absolute,
      code: readFileSync(descriptor, 'utf8'),
      relative: relativePath,
    };
  } finally {
    closeSync(descriptor);
  }
}

function confinedRelative(absolute, srcRoot) {
  const relativePath = relative(srcRoot, absolute);
  if (
    relativePath === '..' ||
    stringStartsWith(relativePath, `..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
