import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { documentedPackages } from '../../scripts/public-packages.mjs';

import { slugify } from './md.mjs';

/**
 * Generated API reference (plan W6): one markdown page per app-facing package,
 * emitted from the real TypeScript sources so the docs cannot drift silently.
 * Undocumented exports are flagged, never omitted (plan exit criterion 4).
 * Output is deterministic: no timestamps, no absolute paths.
 *
 * The set of documented packages is NOT hard-coded here: it is read from the
 * repo-root `public-packages.json` manifest (plan api-cleanup Phase 2), the same
 * source the api-surface CI gate consults, so docs and enforcement cannot diverge.
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Documented packages come from the public-packages.json manifest (sorted by order).
const PACKAGES = documentedPackages();

const UNDOCUMENTED = '*Undocumented.*';
const MAX_SIGNATURE_LINES = 40;
// Type cells in the params table can balloon for complex generics; elide so the
// table stays readable (mirrors MAX_SIGNATURE_LINES discipline for signatures).
const MAX_TYPE_LENGTH = 120;
// Source links in the sidebar manifest point at the real defining file + line on
// GitHub. A fixed ref keeps output deterministic (no timestamps/abs paths).
const GITHUB_BASE = 'https://github.com/kovojs/kovo/blob/main';

function createApiProgram(entryFiles) {
  const configPath = path.join(repoRoot, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  if (configFile.error) {
    throw new Error(`api-ref: cannot read tsconfig.json: ${formatDiagnostics([configFile.error])}`);
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot);
  return ts.createProgram(entryFiles, { ...parsed.options, noEmit: true });
}

function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (!diagnostic.file || diagnostic.start === undefined) return message;
      const { character, line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const file = path.relative(repoRoot, diagnostic.file.fileName);
      return `${file}:${line + 1}:${character + 1} ${message}`;
    })
    .join('\n');
}

function isApiDeclaration(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isModuleDeclaration(node)
  );
}

function kindOf(decl) {
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isEnumDeclaration(decl)) return 'enum';
  if (ts.isVariableDeclaration(decl)) {
    const initializer = decl.initializer;
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return 'function';
    }
    return 'const';
  }
  return 'const';
}

function groupOf(kind) {
  if (kind === 'function') return 'Functions';
  if (kind === 'const') return 'Constants';
  return 'Types & interfaces';
}

function stripExportPrefix(text) {
  return text.replace(/^export\s+(declare\s+)?(default\s+)?/, '');
}

/** The function-like node behind a declaration, if any (a function declaration,
 * or an arrow/function-expression initializing a `const`). Used to read real
 * parameter and return types from the TypeScript AST. */
function functionLikeOf(decl) {
  if (ts.isFunctionDeclaration(decl)) return decl;
  if (
    ts.isVariableDeclaration(decl) &&
    decl.initializer &&
    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
  ) {
    return decl.initializer;
  }
  return undefined;
}

/** Collapse whitespace and elide overlong type text so the params table stays
 * legible (object-literal and deep-generic types can be enormous). */
function normalizeType(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TYPE_LENGTH ? `${collapsed.slice(0, MAX_TYPE_LENGTH - 1)}…` : collapsed;
}

/** Parameter and return types from a declaration's real signature (the
 * TypeScript checker, never JSDoc — JSDoc carries no types). Returns a map of
 * parameter name → type text and the return type, so the params table can show
 * types that cannot drift from the source. */
function signatureTypes(decl, checker) {
  const fn = functionLikeOf(decl);
  const paramTypes = new Map();
  if (!fn) return { paramTypes, returnType: undefined };

  for (const param of fn.parameters) {
    if (!ts.isIdentifier(param.name)) continue;
    let type = param.type ? param.type.getText() : '';
    if (!type) {
      try {
        type = checker.typeToString(checker.getTypeAtLocation(param));
      } catch {
        type = '';
      }
    }
    if (type) paramTypes.set(param.name.text, normalizeType(type));
  }

  let returnType = fn.type ? fn.type.getText() : undefined;
  if (!returnType) {
    try {
      const signature = checker.getSignatureFromDeclaration(fn);
      if (signature) returnType = checker.typeToString(signature.getReturnType());
    } catch {
      returnType = undefined;
    }
  }
  return { paramTypes, returnType: returnType ? normalizeType(returnType) : undefined };
}

/** GitHub blob URL for a declaration's defining file + line. Repo-relative path
 * + a fixed branch ref keep this deterministic. */
function sourceHrefOf(decl) {
  const sourceFile = decl.getSourceFile();
  const relative = path.relative(repoRoot, sourceFile.fileName);
  const { line } = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
  return `${GITHUB_BASE}/${relative}#L${line + 1}`;
}

/** Render one declaration as a signature: full for functions (bodies
 * stripped), source text for everything else. */
function declarationSignature(decl) {
  const sourceFile = decl.getSourceFile();

  if (ts.isFunctionDeclaration(decl)) {
    if (!decl.body) return stripExportPrefix(decl.getText(sourceFile).trim());
    const head = sourceFile.text.slice(decl.getStart(sourceFile), decl.body.getStart(sourceFile));
    return `${stripExportPrefix(head.trim())};`;
  }

  if (ts.isVariableDeclaration(decl)) {
    const keyword =
      decl.parent.flags & ts.NodeFlags.Const
        ? 'const'
        : decl.parent.flags & ts.NodeFlags.Let
          ? 'let'
          : 'var';
    const initializer = decl.initializer;
    if (
      initializer &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
      initializer.body &&
      ts.isBlock(initializer.body)
    ) {
      const head = sourceFile.text.slice(
        decl.getStart(sourceFile),
        initializer.body.getStart(sourceFile),
      );
      return `${keyword} ${head.trim()} { /* … */ };`;
    }
    return `${keyword} ${decl.getText(sourceFile).trim()};`;
  }

  return stripExportPrefix(decl.getText(sourceFile).trim());
}

function truncateSignature(signature, kind) {
  if (kind === 'function') return signature;
  const lines = signature.split('\n');
  if (lines.length <= MAX_SIGNATURE_LINES) return signature;
  const omitted = lines.length - MAX_SIGNATURE_LINES;
  return [
    ...lines.slice(0, MAX_SIGNATURE_LINES),
    `// … truncated (${omitted} more lines); see the package source for the full declaration.`,
  ].join('\n');
}

function cleanJsDoc(raw) {
  return raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*( |$)/, '').trimEnd())
    .join('\n')
    .trim();
}

/**
 * Parse a cleaned JSDoc body into structured parts: the summary (text before
 * the first block tag), `@param`/`@returns` rows, and `@example` code blocks.
 * The whole doc is also kept verbatim so callers that want the raw text (and
 * the SPEC §N citations inside it) still have it.
 */
function parseJsDoc(doc) {
  const lines = doc.split('\n');
  const summaryLines = [];
  const params = [];
  const examples = [];
  let returns;
  let mode = 'summary';
  let buffer = [];

  const flushExample = () => {
    if (mode !== 'example') return;
    examples.push(buffer.join('\n').replace(/\n+$/, ''));
    buffer = [];
  };

  for (const line of lines) {
    const paramMatch = /^@param\s+(\S+)\s*-?\s*(.*)$/.exec(line);
    const returnsMatch = /^@returns?\s*(.*)$/.exec(line);
    const exampleMatch = /^@example\b\s*(.*)$/.exec(line);

    if (paramMatch || returnsMatch || exampleMatch) {
      flushExample();
      if (paramMatch) {
        mode = 'param';
        params.push({ description: paramMatch[2].trim(), name: paramMatch[1] });
      } else if (returnsMatch) {
        mode = 'returns';
        returns = returnsMatch[1].trim();
      } else {
        mode = 'example';
        buffer = exampleMatch[1].trim() ? [exampleMatch[1]] : [];
      }
      continue;
    }

    // Continuation lines extend whatever tag is currently open.
    if (mode === 'summary') {
      summaryLines.push(line);
    } else if (mode === 'param') {
      const last = params[params.length - 1];
      last.description = `${last.description} ${line.trim()}`.trim();
    } else if (mode === 'returns') {
      returns = `${returns} ${line.trim()}`.trim();
    } else if (mode === 'example') {
      buffer.push(line);
    }
  }
  flushExample();

  return {
    examples,
    params,
    returns: returns === undefined || returns === '' ? undefined : returns,
    summary: summaryLines.join('\n').trim(),
  };
}

function escapeTableCell(text) {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

/** Escape type text for a table cell: HTML-escape, and replace `|` (union
 * types) with its entity so it cannot split the GFM table cell. Identifiers are
 * emitted unescaped (they are `[A-Za-z0-9_$]` only) so they can be wrapped in
 * links. */
function escapeTypeText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;');
}

/** Render a parameter/return type as an inline `<code>` cell, linking every
 * identifier that resolves to a documented export (same page → `#anchor`, other
 * documented package → `/api/<slug>/#anchor`). Primitives, type parameters, and
 * external/unresolved names stay plain text. Raw inline HTML survives in a GFM
 * table cell, and pipes are entity-escaped so unions don't break the row. */
function renderTypeCell(typeText, slug, targets) {
  if (!typeText) return '';
  let out = '';
  let last = 0;
  const identifier = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let match;
  while ((match = identifier.exec(typeText)) !== null) {
    out += escapeTypeText(typeText.slice(last, match.index));
    const name = match[0];
    const target = targets.get(name);
    if (target) {
      const href = target.slug === slug ? `#${target.anchor}` : `/api/${target.slug}/#${target.anchor}`;
      out += `<a href="${href}">${name}</a>`;
    } else {
      out += name;
    }
    last = match.index + name.length;
  }
  out += escapeTypeText(typeText.slice(last));
  return `<code>${out}</code>`;
}

function renderParamsTable(parsed, sig, slug, targets) {
  const rows = parsed.params.map(
    (param) =>
      `| \`${param.name}\` | ${renderTypeCell(sig.paramTypes.get(param.name) ?? '', slug, targets)} | ${escapeTableCell(param.description)} |`,
  );
  if (parsed.returns !== undefined) {
    rows.push(
      `| *(returns)* | ${renderTypeCell(sig.returnType ?? '', slug, targets)} | ${escapeTableCell(parsed.returns)} |`,
    );
  }
  if (rows.length === 0) return [];
  return ['| Parameter | Type | Description |', '| --- | --- | --- |', ...rows];
}

/** JSDoc comment for a declaration (variable declarations carry their docs on
 * the enclosing statement). Doc text passes through verbatim so "SPEC §N.N"
 * citations survive for the pipeline's auto-linker. */
function docCommentOf(decl) {
  let node = decl;
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
    node = node.parent.parent;
  }
  const jsDocNodes = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  if (jsDocNodes.length === 0) return '';
  return cleanJsDoc(jsDocNodes[jsDocNodes.length - 1].getText());
}

function resolveAlias(symbol, checker) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/** True if a declaration carries an `@internal` JSDoc tag (variable decls carry
 * tags on the enclosing statement). `@internal` exports are framework internals —
 * reachable for in-repo/emitted consumers but excluded from the public reference. */
function isInternalDeclaration(decl) {
  let node = decl;
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
    node = node.parent.parent;
  }
  return ts.getJSDocTags(node).some((tag) => tag.tagName.getText() === 'internal');
}

function entryFromSymbol(name, symbol, checker, packageName) {
  const resolved = resolveAlias(symbol, checker);
  const declarations = (resolved.declarations ?? []).filter(isApiDeclaration);
  if (declarations.length === 0) {
    throw new Error(
      `api-ref: export "${name}" of ${packageName} does not resolve to a declaration — fix the export or the generator`,
    );
  }

  const internal = declarations.some(isInternalDeclaration);

  // Function overloads: show the signature declarations, not the implementation.
  const overloads = declarations.filter((decl) => ts.isFunctionDeclaration(decl) && !decl.body);
  const rendered = overloads.length > 0 ? overloads : [declarations[0]];

  const kind = kindOf(declarations[0]);
  const signature = truncateSignature(
    rendered.map((decl) => declarationSignature(decl)).join('\n'),
    kind,
  );
  const doc = declarations.map((decl) => docCommentOf(decl)).find((text) => text !== '') ?? '';

  return {
    anchor: slugify(name),
    doc,
    internal,
    kind,
    name,
    signature,
    sig: signatureTypes(rendered[0], checker),
    sourceHref: sourceHrefOf(declarations[0]),
  };
}

function hasExportModifier(statement) {
  return (
    ts.canHaveModifiers(statement) &&
    (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function declarationOrder(symbol) {
  const decl = symbol.declarations?.[0];
  if (!decl) return ['', 0];
  return [decl.getSourceFile().fileName, decl.getStart()];
}

/** Exports of one package index, in source order. Re-exports are followed to
 * their defining module; `export *` expands that module's export set. */
function collectExports(sourceFile, checker, packageName) {
  const entries = [];
  const seen = new Set();
  const push = (entry) => {
    if (entry.internal) return; // @internal exports are excluded from the public reference
    if (seen.has(entry.name)) return;
    seen.add(entry.name);
    entries.push(entry);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const symbol = checker.getSymbolAtLocation(element.name);
          if (!symbol) {
            throw new Error(
              `api-ref: cannot resolve export "${element.name.text}" in ${packageName}`,
            );
          }
          push(entryFromSymbol(element.name.text, symbol, checker, packageName));
        }
      } else if (!statement.exportClause && statement.moduleSpecifier) {
        // export * from './module.js'
        const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
        if (!moduleSymbol) {
          throw new Error(
            `api-ref: cannot resolve module ${statement.moduleSpecifier.getText()} re-exported by ${packageName}`,
          );
        }
        const exported = [...checker.getExportsOfModule(moduleSymbol)].sort((a, b) => {
          const [fileA, posA] = declarationOrder(a);
          const [fileB, posB] = declarationOrder(b);
          return fileA === fileB ? posA - posB : fileA < fileB ? -1 : 1;
        });
        for (const symbol of exported) {
          push(entryFromSymbol(symbol.name, symbol, checker, packageName));
        }
      }
      continue;
    }

    if (!hasExportModifier(statement)) continue;

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue; // binding patterns: not part of this surface
        const symbol = checker.getSymbolAtLocation(decl.name);
        if (symbol) push(entryFromSymbol(decl.name.text, symbol, checker, packageName));
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name &&
      ts.isIdentifier(statement.name)
    ) {
      const symbol = checker.getSymbolAtLocation(statement.name);
      if (symbol) push(entryFromSymbol(statement.name.text, symbol, checker, packageName));
    }
  }

  return entries;
}

/** Render one export: summary prose, a params/returns table, the type
 * signature, then each `@example` as its own fenced `ts` block (the shape the
 * `@example` typecheck gate extracts). Undocumented exports keep the explicit
 * marker so they are flagged, never omitted. */
function renderEntry(entry, slug, targets) {
  const parsed = entry.doc === '' ? undefined : parseJsDoc(entry.doc);
  const body = parsed && parsed.summary !== '' ? parsed.summary : entry.doc;

  const lines = [`### \`${entry.name}\``, '', entry.doc === '' ? UNDOCUMENTED : body, ''];

  if (parsed) {
    const table = renderParamsTable(parsed, entry.sig, slug, targets);
    if (table.length > 0) lines.push(...table, '');
  }

  lines.push('```ts', entry.signature, '```');

  if (parsed) {
    for (const example of parsed.examples) {
      lines.push('', '**Example**', '', '```ts', example, '```');
    }
  }

  return lines.join('\n');
}

/** The category grouping shared by the rendered page and the sidebar manifest,
 * in display order. */
function categoryGroups(entries) {
  return [
    { entries: entries.filter((entry) => groupOf(entry.kind) === 'Functions'), title: 'Functions' },
    {
      entries: entries.filter((entry) => groupOf(entry.kind) === 'Types & interfaces'),
      title: 'Types & interfaces',
    },
    { entries: entries.filter((entry) => groupOf(entry.kind) === 'Constants'), title: 'Constants' },
  ].filter((group) => group.entries.length > 0);
}

function renderPage(pkg, entries, entryRel, targets) {
  const groups = categoryGroups(entries);
  const documented = entries.filter((entry) => entry.doc !== '').length;

  return [
    '---',
    `title: "${pkg.name}"`,
    `description: ${pkg.description}`,
    `order: ${pkg.order}`,
    '---',
    '',
    `# ${pkg.name}`,
    '',
    `Generated from \`${entryRel}\` — ${entries.length} exports, ${documented} documented. Do not edit by hand.`,
    '',
    ...groups.flatMap((group) => [
      `## ${group.title}`,
      '',
      ...group.entries.flatMap((entry) => [renderEntry(entry, pkg.slug, targets), '']),
    ]),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Structured sidebar data consumed by the docs site's API navigation: one
 * collapsible group per category, each symbol carrying its anchor, kind, and a
 * link to the defining source line. Deterministic (repo-relative source paths +
 * a fixed GitHub ref). */
function buildSidebar(pkg, entries, entryRel) {
  return {
    package: pkg.name,
    slug: pkg.slug,
    sourceHref: `${GITHUB_BASE}/${entryRel}`,
    categories: categoryGroups(entries).map((group) => ({
      title: group.title,
      anchor: slugify(group.title),
      symbols: group.entries.map((entry) => ({
        name: entry.name,
        anchor: entry.anchor,
        kind: entry.kind,
        documented: entry.doc !== '',
        sourceHref: entry.sourceHref,
      })),
    })),
  };
}

/**
 * Resolve a package's documented entry from its real `package.json` `exports["."]`
 * target — never a hard-coded `src/index.ts`, which silently misdocuments packages
 * whose published `.` entry is a different file (e.g. `@kovojs/drizzle` ships
 * `src/runtime.ts`). api-ref reads TypeScript source, so when conditional exports
 * are introduced (plan Phase 3) the `source`/`development` condition is preferred
 * over the built `dist` target.
 */
function resolvePackageEntry(pkg) {
  const pkgJsonPath = path.join(repoRoot, 'packages', pkg.dir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      `api-ref: package.json missing for ${pkg.name}: ${path.relative(repoRoot, pkgJsonPath)}`,
    );
  }
  const pkgJson = JSON.parse(ts.sys.readFile(pkgJsonPath) ?? '{}');
  const dot = pkgJson.exports?.['.'];
  const target =
    typeof dot === 'string'
      ? dot
      : dot && typeof dot === 'object'
        ? (dot.source ?? dot.development ?? dot.import ?? dot.default)
        : undefined;
  if (typeof target !== 'string') {
    throw new Error(`api-ref: ${pkg.name} has no resolvable "." export in package.json`);
  }
  const absPath = path.join(repoRoot, 'packages', pkg.dir, target);
  return { absPath, repoRelative: path.relative(repoRoot, absPath) };
}

export async function generateApiReference({ outDir = path.join(siteRoot, 'gen/api') } = {}) {
  const resolvedEntries = PACKAGES.map((pkg) => resolvePackageEntry(pkg));
  const entryFiles = resolvedEntries.map((entry) => entry.absPath);
  for (const file of entryFiles) {
    if (!existsSync(file)) {
      throw new Error(`api-ref: package entry point missing: ${path.relative(repoRoot, file)}`);
    }
  }

  const program = createApiProgram(entryFiles);
  const checker = program.getTypeChecker();

  // Drift must be loud: refuse to emit pages from sources that do not parse.
  const syntaxErrors = program
    .getSourceFiles()
    .filter((sourceFile) => !sourceFile.fileName.includes('node_modules'))
    .flatMap((sourceFile) => [...program.getSyntacticDiagnostics(sourceFile)]);
  if (syntaxErrors.length > 0) {
    throw new Error(`api-ref: sources have parse errors:\n${formatDiagnostics(syntaxErrors)}`);
  }

  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });

  // Pass 1: collect every package's exports and build the global name → target
  // map (symbol name → its page slug + anchor) so type tokens can be linked
  // across packages, not just within a page.
  const collected = [];
  const targets = new Map();
  for (const [index, pkg] of PACKAGES.entries()) {
    const sourceFile = program.getSourceFile(entryFiles[index]);
    if (!sourceFile) {
      throw new Error(
        `api-ref: TypeScript did not load ${path.relative(repoRoot, entryFiles[index])}`,
      );
    }
    const entries = collectExports(sourceFile, checker, pkg.name);
    if (entries.length === 0) {
      throw new Error(`api-ref: ${pkg.name} has no exports — wrong entry point?`);
    }
    collected.push({ entries, entryRel: resolvedEntries[index].repoRelative, pkg });
    for (const entry of entries) {
      // First package that owns a name wins (packages are in display order), so
      // links are stable and a re-export does not flip the target.
      if (!targets.has(entry.name)) {
        targets.set(entry.name, { slug: pkg.slug, anchor: entry.anchor });
      }
    }
  }

  // Pass 2: render each page (type links resolved against the global map) and
  // emit its sidebar manifest.
  const report = [];
  for (const { entries, entryRel, pkg } of collected) {
    await writeFile(
      path.join(outDir, `${pkg.slug}.md`),
      `${renderPage(pkg, entries, entryRel, targets)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(outDir, `${pkg.slug}.sidebar.json`),
      `${JSON.stringify(buildSidebar(pkg, entries, entryRel), null, 2)}\n`,
      'utf8',
    );
    report.push({
      documented: entries.filter((entry) => entry.doc !== '').length,
      exports: entries.length,
      file: `${pkg.slug}.md`,
      name: pkg.name,
      names: entries.map((entry) => entry.name),
    });
  }

  const totals = report.reduce(
    (sum, pkg) => ({
      documented: sum.documented + pkg.documented,
      exports: sum.exports + pkg.exports,
    }),
    { documented: 0, exports: 0 },
  );
  process.stdout.write(
    `api-ref/v1 packages=${report.length} exports=${totals.exports} documented=${totals.documented}\n`,
  );

  return { packages: report, ...totals };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateApiReference();
}
