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
  realpathSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

import { snapshotDiagnostics } from './diagnostics.mjs';
import { buildDataflowGraph } from './graph-model.mjs';
import {
  arrayAppend,
  arrayLength,
  arraySlice,
  arrayValue,
  assertPlainCarrier,
  isSafeInteger,
  joinStrings,
  stableOwnData,
  stringCharCodeAt,
  stringEndsWith,
  stringSlice,
  stringSplit,
  stringStartsWith,
} from './output-security.mjs';

const FILE_TYPE_MASK = constants.S_IFMT;
const FILE_TYPE_DIRECTORY = constants.S_IFDIR;
const FILE_TYPE_REGULAR = constants.S_IFREG;
const FILE_TYPE_SYMLINK = constants.S_IFLNK;
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const SOURCE_OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * @param {{ app: string, label?: string, blurb?: string, diagnostics?: readonly any[], graph: any, limitations?: string[], provenance?: string, srcRoot: string, view?: 'source-graph'|'runtime-registry' }} opts
 * @returns {{ app: string, label: string, blurb: string, limitations: string[], provenance: string, view: 'source-graph'|'runtime-registry', nodes: any[], edges: any[], counts: Record<string, number> }}
 */
export function buildBundle({
  app,
  label,
  blurb,
  diagnostics = [],
  graph,
  limitations = [],
  provenance,
  srcRoot,
  view = 'source-graph',
}) {
  const g = buildDataflowGraph(graph);
  const diagnosticFacts = snapshotDiagnostics(diagnostics, 'Devtool diagnostics');
  for (let index = 0; index < arrayLength(diagnosticFacts, 'Devtool diagnostics'); index += 1) {
    const diagnostic = arrayValue(diagnosticFacts, index, 'Devtool diagnostics');
    arrayAppend(
      g.nodes,
      {
        ...(diagnostic.source === undefined ? {} : { anchor: diagnostic.source }),
        data: diagnostic,
        id: `diagnostic:${diagnostic.code}:${index}`,
        kind: 'diagnostic',
        label: diagnostic.code,
        name: diagnostic.code,
      },
      'Devtool graph nodes',
    );
  }
  const canonicalSrcRoot = canonicalSourceRoot(srcRoot);
  for (const node of g.nodes) node.source = resolveSource(node, canonicalSrcRoot);
  const counts = {};
  for (const n of g.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  return {
    app,
    label: label ?? app,
    blurb: blurb ?? '',
    limitations,
    provenance: provenance ?? 'derived from generated/graph.json',
    view,
    nodes: g.nodes,
    edges: g.edges,
    counts,
  };
}

export function resolveSource(node, srcRoot) {
  try {
    const canonicalSrcRoot = canonicalSourceRoot(srcRoot);
    const anchorProperty = stableOwnData(node, 'anchor', 'Devtool dataflow node');
    if (!anchorProperty.found) return null;
    const exact = anchoredBlock(anchorProperty.value, canonicalSrcRoot);
    if (exact && node.kind === 'mutation') {
      exact.touches = (node.data.touch?.touches ?? []).map((touch) => ({ ...touch }));
    }
    return exact;
  } catch {
    // An invalid or unresolvable compiler anchor fails closed. SPEC §5.2 rule 13 forbids
    // post-parse symbol/text rediscovery because it can preview a different declaration.
    return null;
  }
}

function anchoredBlock(value, srcRoot) {
  const anchor = snapshotSourceAnchor(value);
  const candidates = [];
  if (isAbsolute(anchor.file)) {
    arrayAppend(candidates, anchor.file, 'Devtool anchored source candidates');
  } else {
    arrayAppend(candidates, join(srcRoot, anchor.file), 'Devtool anchored source candidates');
    const rootPrefix = `${basename(srcRoot)}/`;
    if (stringStartsWith(anchor.file, rootPrefix)) {
      arrayAppend(
        candidates,
        join(srcRoot, stringSlice(anchor.file, rootPrefix.length)),
        'Devtool anchored source candidates',
      );
    }
  }

  let pinnedSourceFile = null;
  for (
    let index = 0;
    index < arrayLength(candidates, 'Devtool anchored source candidates');
    index += 1
  ) {
    try {
      const sourceFile = confinedSourceFile(
        arrayValue(candidates, index, 'Devtool anchored source candidates'),
        srcRoot,
      );
      if (sourceFile) {
        pinnedSourceFile = readPinnedSourceFile(sourceFile, srcRoot);
        if (pinnedSourceFile) break;
      }
    } catch {
      // Try the next deterministic root-relative spelling. A failed exact anchor never falls back
      // to symbol heuristics, because that could preview an unrelated declaration.
    }
  }
  if (!pinnedSourceFile || anchor.end > pinnedSourceFile.code.length) return null;

  const start = sourceOffsetPosition(pinnedSourceFile.code, anchor.start);
  const end = sourceOffsetPosition(pinnedSourceFile.code, anchor.end);
  const lines = stringSplit(pinnedSourceFile.code, '\n');
  const contextStart = start.line > 2 ? start.line - 2 : 0;
  const endCandidate = end.line + 2;
  const contextEnd =
    endCandidate < arrayLength(lines, 'Devtool anchored source lines')
      ? endCandidate
      : arrayLength(lines, 'Devtool anchored source lines') - 1;
  const codeLines = arraySlice(
    lines,
    contextStart,
    contextEnd + 1,
    'Devtool anchored source lines',
  );
  return {
    anchorLine: start.line + 1,
    code: joinStrings(codeLines, '\n', 'Devtool anchored source preview'),
    end: anchor.end,
    endLine: contextEnd + 1,
    file: pinnedSourceFile.relative,
    highlight: {
      end: { column: end.column + 1, line: end.line + 1 },
      start: { column: start.column + 1, line: start.line + 1 },
    },
    lang: stringEndsWith(pinnedSourceFile.absolute, '.tsx')
      ? 'tsx'
      : stringEndsWith(pinnedSourceFile.absolute, '.jsx')
        ? 'jsx'
        : stringEndsWith(pinnedSourceFile.absolute, '.js')
          ? 'js'
          : 'ts',
    start: anchor.start,
    startLine: contextStart + 1,
  };
}

function snapshotSourceAnchor(value) {
  const anchor = assertPlainCarrier(value, 'Devtool source anchor');
  const file = stableOwnData(anchor, 'file', 'Devtool source anchor');
  const start = stableOwnData(anchor, 'start', 'Devtool source anchor');
  const end = stableOwnData(anchor, 'end', 'Devtool source anchor');
  if (
    !file.found ||
    typeof file.value !== 'string' ||
    file.value.length === 0 ||
    file.value.length > 4_096
  ) {
    throw new TypeError('Devtool source anchor.file must be a bounded non-empty string.');
  }
  if (
    !start.found ||
    !end.found ||
    !isSafeInteger(start.value) ||
    !isSafeInteger(end.value) ||
    start.value < 0 ||
    end.value < start.value
  ) {
    throw new TypeError('Devtool source anchor offsets must be ordered safe integers.');
  }
  return { end: end.value, file: file.value, start: start.value };
}

function sourceOffsetPosition(source, offset) {
  let line = 0;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (stringCharCodeAt(source, index) === 10) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { column, line };
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

function confinedSourceFile(file, srcRoot) {
  const direct = lstatSync(file);
  if ((direct.mode & FILE_TYPE_MASK) === FILE_TYPE_SYMLINK) return null;
  const absolute = realpathSync(file);
  const relativePath = confinedRelative(absolute, srcRoot);
  if (relativePath === null) return null;
  if (
    !stringEndsWith(absolute, '.js') &&
    !stringEndsWith(absolute, '.jsx') &&
    !stringEndsWith(absolute, '.ts') &&
    !stringEndsWith(absolute, '.tsx')
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
