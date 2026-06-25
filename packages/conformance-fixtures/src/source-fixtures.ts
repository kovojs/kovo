import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProjectSourceSiteFact {
  line: number;
  path: string;
}

export interface ProjectSourceSiteSummaryFact {
  count: number;
  linesArePositive: boolean;
  paths: string[];
}

export interface ProjectSourceLineFact extends ProjectSourceSiteFact {
  sourceLine: string;
}

export interface ProjectFileTreeOptions {
  directory: string;
  include?: (path: string) => boolean;
  rootPath: string;
}

export interface ProjectFileSourceFact {
  path: string;
  source: string;
}

export interface ProjectPackageManifestFact<
  T = { name?: unknown; scripts?: Record<string, unknown> },
> {
  directory: string;
  manifest: T;
}

export interface ForbiddenBrowserArchitectureFact {
  column: number;
  fileName: string;
  label: string;
  line: number;
  site: string;
}

export interface ForbiddenBrowserArchitectureProjectFact {
  checkedFileCount: number;
  clean: boolean;
  violations: ForbiddenBrowserArchitectureFact[];
}

export interface PostParseSourceStringFact {
  column: number;
  fileName: string;
  label: string;
  line: number;
  site: string;
}

export interface PostParseSourceStringProjectFact {
  checkedFileCount: number;
  clean: boolean;
  violations: PostParseSourceStringFact[];
}

export interface ProjectSourceFixture {
  fileName: string;
  source: string;
}

export interface ModuleImportFailureFact {
  allowed: boolean;
  matchedReason: string | null;
}

export interface ProjectQueryDiagnosticFact {
  code: string;
  message: string;
  severity: string;
  site: string;
}

export interface ProjectQueryBehaviorFact {
  diagnostics?: ProjectQueryDiagnosticFact[];
  instanceKey?: unknown;
  query: string;
  reads: readonly string[];
  shape: unknown;
  site: string;
}

export interface ProjectTouchGraphTouchFact {
  domain: string;
  keys?: string | null;
  predicate?: string;
  site: string;
  via: string;
}

export interface ProjectTouchGraphEntryFact {
  reads?: readonly unknown[];
  touches?: readonly ProjectTouchGraphTouchFact[];
  unresolved?: readonly unknown[];
}

export interface ProjectTouchGraphBehaviorFact {
  reads: readonly unknown[];
  touches: readonly ProjectTouchGraphTouchFact[];
  unresolved: readonly unknown[];
}

export interface DrizzleQueryBehaviorSourceFixtures {
  exemptRead: ProjectSourceFixture[];
  exemptWriteTouch: ProjectSourceFixture[];
  importedSchemaProject: ProjectSourceFixture[];
  nonKeyPredicate: ProjectSourceFixture[];
  opaqueProjection: ProjectSourceFixture[];
  selectShape: ProjectSourceFixture[];
  sqlitePortability: ProjectSourceFixture[];
}

export interface CssScopeRuleFact {
  limit: string;
  raw: string;
  scope: string;
}

type TypeScriptModule = typeof import('typescript');

export function cssLayerNames(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .map((line) => /^@layer\s+([^;{]+)(?:[;{].*)?$/.exec(line)?.[1]?.trim())
    .filter((layer): layer is string => Boolean(layer));
}

export function cssScopeRules(source: string): CssScopeRuleFact[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      const match = /^@scope\s+\((.+)\)\s+to\s+\((.+)\)\s+\{$/.exec(line);
      return match
        ? {
            limit: match[2] ?? '',
            raw: line,
            scope: match[1] ?? '',
          }
        : undefined;
    })
    .filter((rule): rule is CssScopeRuleFact => rule !== undefined);
}

export function moduleImportFailureFact(
  error: unknown,
  allowedReasons: readonly string[],
): ModuleImportFailureFact {
  const message = String(
    error && typeof error === 'object' && 'stack' in error ? error.stack : error,
  );
  const matchedReason = allowedReasons.find((reason) => message.includes(reason)) ?? null;

  return {
    allowed: matchedReason !== null,
    matchedReason,
  };
}

export function drizzleQueryBehaviorSourceFixtures(): DrizzleQueryBehaviorSourceFixtures {
  return {
    exemptRead: [
      {
        fileName: 'product.queries.ts',
        source: `
        export const auditLog = pgTable("audit_log", {}, kovo({ exempt: true }));
        export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));

        export const productQuery = query("product", {
          async load(_input, db) {
            return db.select({
              message: auditLog.message,
              name: products.name,
            }).from(products).leftJoin(auditLog, eq(auditLog.productId, products.id));
          },
        });
      `,
      },
    ],
    exemptWriteTouch: [
      {
        fileName: 'cart.domain.ts',
        source: `
          export const auditLog = pgTable("audit_log", {}, kovo({ exempt: true }));
          export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

          export async function writeAudit(db) {
            await db.insert(auditLog).values({ event: "cart" });
          }

          export async function addItem(db, cartId) {
            await db.insert(cartItems).values({ cartId });
          }
        `,
      },
    ],
    importedSchemaProject: [
      {
        fileName: 'cart.schema.ts',
        source: `
          export const items = pgTable("cart_items", {}, kovo({ domain: "cart", key: "id" }));
        `,
      },
      {
        fileName: 'order.schema.ts',
        source: `
          export const items = pgTable("order_items", {}, kovo({ domain: "order", key: "id" }));
        `,
      },
      {
        fileName: 'cart.queries.ts',
        source: `
          import { items } from "./cart.schema";

          export const cartQuery = query("cart", {
            load(input, db) {
              return db.select({ id: items.id }).from(items).where(eq(items.id, input.id));
            },
          });
        `,
      },
    ],
    nonKeyPredicate: [
      {
        fileName: 'product.queries.ts',
        source: `
        export const products = pgTable("products", {}, kovo({ domain: "product", key: "id" }));

        export const productQuery = query("product", {
          load(input, db) {
            return db.select({ sku: products.sku }).from(products).where(eq(products.sku, input.sku));
          },
        });
      `,
      },
    ],
    opaqueProjection: [
      {
        fileName: 'cart.queries.ts',
        source: `
        export const cartItems = pgTable("cart_items", {}, kovo({ domain: "cart", key: "cartId" }));

        export const cartQuery = query("cart", {
          async load(input, db) {
            return db.select({
              count: sql<number>\`count(*)\`,
            }).from(cartItems).where(eq(cartItems.cartId, input.cartId));
          },
        });
      `,
      },
    ],
    selectShape: [
      {
        fileName: 'cart.queries.ts',
        source: `
        export const cartItems = pgTable("cart_items", {
          cartId: text("cart_id").notNull(),
          productId: text("product_id"),
          qty: integer("qty").notNull(),
        }, kovo({ domain: "cart", key: "cartId" }));
        export const products = pgTable("products", {
          id: text("id").primaryKey(),
          name: text("name").notNull(),
        }, kovo({ domain: "product", key: "id" }));

        export const cartQuery = query("cart", {
          output: s.object({ count: s.number() }),
          async load(input, db) {
            return db.select({
              count: sql<number>\`count(*)\`,
              productId: products.id,
              item: {
                qty: cartItems.qty,
              },
            }).from(cartItems).innerJoin(products, eq(products.id, cartItems.productId)).where(eq(cartItems.cartId, input.cartId));
          },
        });
      `,
      },
    ],
    sqlitePortability: [
      {
        fileName: 'sqlite.schema.ts',
        source: `
          import { kovo } from "@kovojs/drizzle";
          import { integer, sqliteTable, sqliteView, text } from "drizzle-orm/sqlite-core";

          export const products = sqliteTable("products", {
            active: integer("active", { mode: "boolean" }).notNull(),
            id: text("id").primaryKey(),
            metadata: text("metadata", { mode: "json" }),
            stock: integer("stock").notNull(),
          }, kovo({ domain: "product", key: "id" }));

          export const productSearch = sqliteView("product_search").as((qb) =>
            qb.select({ name: products.id }).from(products),
          );
        `,
      },
      {
        fileName: 'sqlite.domain.ts',
        source: `
          import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
          import { eq, sql } from "drizzle-orm";
          import { products, productSearch } from "./sqlite.schema";

          export async function reserveProduct(db: BaseSQLiteDatabase, productId: string) {
            await db.update(products)
              .set({ stock: sql\`\${products.stock} - 1\` })
              .where(eq(products.id, productId));
          }

          export const productQuery = query("product/sqlite", {
            load(input, db: BaseSQLiteDatabase) {
              return db.select({
                active: products.active,
                id: products.id,
                metadata: products.metadata,
                stock: products.stock,
              }).from(products).where(eq(products.id, input.id));
            },
          });

          export const searchQuery = query("search/sqlite", {
            output: s.object({ id: s.string() }),
            load(_input, db: BaseSQLiteDatabase) {
              return db.select({ id: sql<string>\`id\` }).from(productSearch);
            },
          });
        `,
      },
    ],
  };
}

export function projectQueryBehaviorFacts(facts: readonly unknown[]): ProjectQueryBehaviorFact[] {
  return facts.map((fact) => {
    const queryFact = fact as {
      diagnostics?: ProjectQueryDiagnosticFact[];
      instanceKey?: unknown;
      query?: unknown;
      reads?: readonly string[];
      shape?: unknown;
      site?: unknown;
    };
    if (typeof queryFact.query !== 'string')
      assertProjectSourceFact(false, 'query fact has a name');
    if (typeof queryFact.site !== 'string') assertProjectSourceFact(false, 'query fact has a site');
    if (!Array.isArray(queryFact.reads)) {
      assertProjectSourceFact(false, `query ${queryFact.query} has read domains`);
    }

    return {
      ...(queryFact.diagnostics ? { diagnostics: queryFact.diagnostics } : {}),
      ...(queryFact.instanceKey !== undefined ? { instanceKey: queryFact.instanceKey } : {}),
      query: queryFact.query,
      reads: queryFact.reads,
      shape: queryFact.shape,
      site: queryFact.site,
    };
  });
}

export function projectQueryDiagnosticFacts(
  facts: readonly unknown[],
): ProjectQueryDiagnosticFact[] {
  return projectQueryBehaviorFacts(facts).flatMap((fact) => fact.diagnostics ?? []);
}

export function projectTouchGraphBehaviorFacts(
  touchGraph: Record<string, ProjectTouchGraphEntryFact>,
): Record<string, ProjectTouchGraphBehaviorFact> {
  return Object.fromEntries(
    Object.entries(touchGraph).map(([name, entry]) => [
      name,
      {
        reads: entry.reads ?? [],
        touches: entry.touches ?? [],
        unresolved: entry.unresolved ?? [],
      },
    ]),
  );
}

export function projectSourceSiteFact(site: string): ProjectSourceSiteFact {
  const separator = site.lastIndexOf(':');
  if (separator === -1) {
    throw new Error(`Project source site includes a line number: ${site}`);
  }

  const line = Number(site.slice(separator + 1));
  if (!Number.isInteger(line) || line <= 0) {
    throw new Error(`Project source site line is positive: ${site}`);
  }

  return { line, path: site.slice(0, separator) };
}

function assertProjectSourceFact(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Project source fixture fact invariant failed: ${message}`);
  }
}

export function projectSourceSiteFacts(sites: readonly string[]): ProjectSourceSiteFact[] {
  return sites.map(projectSourceSiteFact);
}

export function projectSourceSiteSummaryFact(
  sites: readonly string[],
): ProjectSourceSiteSummaryFact {
  const facts = projectSourceSiteFacts(sites);

  return {
    count: facts.length,
    linesArePositive: facts.every((site) => site.line > 0),
    paths: [...new Set(facts.map((site) => site.path))].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export async function projectSourceLineFacts(
  rootPath: string,
  sites: readonly string[],
): Promise<ProjectSourceLineFact[]> {
  const sourceByPath = new Map<string, string[]>();
  const facts: ProjectSourceLineFact[] = [];

  for (const site of projectSourceSiteFacts(sites)) {
    let lines = sourceByPath.get(site.path);
    if (!lines) {
      lines = (await readFile(join(rootPath, site.path), 'utf8')).split('\n');
      sourceByPath.set(site.path, lines);
    }

    const sourceLine = lines[site.line - 1];
    if (sourceLine === undefined) {
      throw new Error(`Project source site resolves to a source line: ${site.path}:${site.line}`);
    }

    facts.push({ ...site, sourceLine: sourceLine.trim() });
  }

  return facts;
}

export async function projectDirectoryNames(options: ProjectFileTreeOptions): Promise<string[]> {
  const entries = await readdir(join(options.rootPath, options.directory), {
    withFileTypes: true,
  });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${options.directory}/${entry.name}`)
    .filter((path) => options.include?.(path) ?? true);

  return names.sort((left, right) => left.localeCompare(right));
}

export async function projectFilePaths(options: ProjectFileTreeOptions): Promise<string[]> {
  const paths = await projectFileTreeEntries(options);
  return paths.sort((left, right) => left.localeCompare(right));
}

export async function projectFileSources(
  options: ProjectFileTreeOptions,
): Promise<ProjectFileSourceFact[]> {
  return Promise.all(
    (await projectFilePaths(options)).map(async (path) => ({
      path,
      source: await readFile(join(options.rootPath, path), 'utf8'),
    })),
  );
}

export async function forbiddenBrowserArchitectureProjectFact(options: {
  rootPath: string;
  ts: TypeScriptModule;
}): Promise<ForbiddenBrowserArchitectureProjectFact> {
  const sources = await projectFileSources({
    rootPath: options.rootPath,
    directory: 'packages',
    include: (path) => path.endsWith('.ts') && path.includes('/src/') && !path.endsWith('.test.ts'),
  });
  const violations = sources.flatMap(({ path, source }) =>
    forbiddenBrowserArchitectureFacts(options.ts, path, source),
  );

  return {
    checkedFileCount: sources.length,
    clean: violations.length === 0,
    violations,
  };
}

export async function projectJsonFile<T = unknown>(rootPath: string, path: string): Promise<T> {
  return JSON.parse(await readFile(join(rootPath, path), 'utf8')) as T;
}

export async function projectPackageManifestFacts<
  T extends { name?: unknown; scripts?: Record<string, unknown> } = {
    name?: unknown;
    scripts?: Record<string, unknown>;
  },
>(options: ProjectFileTreeOptions): Promise<ProjectPackageManifestFact<T>[]> {
  const directories = await projectDirectoryNames(options);
  return Promise.all(
    directories.map(async (directory) => ({
      directory: directory.slice(`${options.directory}/`.length),
      manifest: await projectJsonFile<T>(options.rootPath, `${directory}/package.json`),
    })),
  );
}

export function forbiddenBrowserArchitectureFacts(
  ts: TypeScriptModule,
  fileName: string,
  source: string,
): ForbiddenBrowserArchitectureFact[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts: ForbiddenBrowserArchitectureFact[] = [];
  const nodeName = (node: import('typescript').Expression): string | undefined =>
    ts.isIdentifier(node)
      ? node.text
      : ts.isPropertyAccessExpression(node)
        ? node.name.text
        : undefined;
  const isStringValue = (node: import('typescript').Node | undefined, value: string) =>
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === value;
  const record = (node: import('typescript').Node, label: string) => {
    const { character, line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    facts.push({
      column: character + 1,
      fileName,
      label,
      line: line + 1,
      site: `${fileName}:${line + 1}:${character + 1}`,
    });
  };

  const visit = (node: import('typescript').Node) => {
    if (ts.isCallExpression(node)) {
      const callName = nodeName(node.expression);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        callName === 'define' &&
        nodeName(node.expression.expression) === 'customElements'
      ) {
        record(node, 'customElements.define');
      }
      if (callName === 'attachShadow') {
        record(node, 'attachShadow');
      }
      if (callName === 'addEventListener' && isStringValue(node.arguments[0], 'unload')) {
        record(node, 'addEventListener unload');
      }
      if (callName === 'createBrowserRouter' || callName === 'hydrateRoot') {
        record(node, callName);
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'onunload') ||
      (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'onunload')
    ) {
      record(node, 'onunload');
    }

    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'script'
    ) {
      for (const property of node.attributes.properties) {
        if (
          ts.isJsxAttribute(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'type' &&
          isStringValue(property.initializer, 'importmap')
        ) {
          record(property, 'importmap script');
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

// SPEC §5.2: after parsing, compiler post-parse phases (lower/validate/analyze/emit + graph.ts)
// must make decisions from typed model facts and spans, never from raw source snippets, regexes,
// getText(), or ad hoc string slicing. This globs only those zones and flags decision-shaped
// operations whose operand is a known raw-source carrier. Span-based source-patch application,
// generated-artifact body carry, IR-header provenance, binding-path grammar on `.path`, URL/route
// parsing of literal attribute values, and name-formatting of model-derived identifiers are
// intentionally NOT flagged.
export async function postParseSourceStringProjectFact(options: {
  rootPath: string;
  ts: TypeScriptModule;
}): Promise<PostParseSourceStringProjectFact> {
  const sources = await projectFileSources({
    rootPath: options.rootPath,
    directory: 'packages/compiler/src',
    include: (path) => isPostParseGuardedFile(path),
  });
  const violations = sources.flatMap(({ path, source }) =>
    postParseSourceStringFacts(options.ts, path, source),
  );

  return {
    checkedFileCount: sources.length,
    clean: violations.length === 0,
    violations,
  };
}

function isPostParseGuardedFile(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.test.ts')) return false;
  return (
    path === 'packages/compiler/src/app-graph.ts' ||
    path === 'packages/compiler/src/compile.ts' ||
    path === 'packages/compiler/src/graph.ts' ||
    // `security/` is a post-parse decision surface (output-context KV236 classification) and must be
    // policed by the same hard-rule #9 guard; its prior exclusion let the KV236 trusted-brand gate
    // make a `/^trustedHtml\(/` raw-source-text decision (F1, plans/compiler-soundness.md).
    /^packages\/compiler\/src\/(lower|validate|analyze|emit|security)\//.test(path)
  );
}

// Property names that, when accessed on a model object, carry a verbatim slice of app source code
// (i.e. a decision over them post-parse would be a source-string decision).
const rawSourcePropertyNames = new Set(['expression', 'body', 'text', 'callArguments']);

// Methods that normalize a string while preserving whether it is raw app source.
const stringNormalizerMethods = new Set([
  'trim',
  'trimEnd',
  'trimStart',
  'toLowerCase',
  'toUpperCase',
]);

// Bare local identifiers that hold a raw source snippet inside the guarded zones.
const rawSourceIdentifierNames = new Set([
  'arg',
  'argument',
  'callArguments',
  'expression',
  'rawSource',
  'snippet',
  'source',
]);

// Base receiver names whose `.expression`/`.body` are model-COMPUTED facts (not raw carriers); an
// access like `candidate.expression` or `derive.expression` is allowed even though the final name
// matches a raw-source property name.
const computedFactReceiverNames = new Set([
  'access',
  'binding',
  'candidate',
  'derive',
  'entry',
  'fact',
  'input',
  'item',
  'link',
  'lowering',
  'param',
  'placeholder',
  'plan',
  'segment',
  'stamp',
  'value',
]);

export function postParseSourceStringFacts(
  ts: TypeScriptModule,
  fileName: string,
  source: string,
): PostParseSourceStringFact[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const facts: PostParseSourceStringFact[] = [];
  const record = (node: import('typescript').Node, label: string) => {
    const { character, line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    facts.push({
      column: character + 1,
      fileName,
      label,
      line: line + 1,
      site: `${fileName}:${line + 1}:${character + 1}`,
    });
  };

  // The base receiver of a property/element access, walking through chained accesses to the root.
  const accessRootName = (expression: import('typescript').Expression): string | undefined => {
    let current: import('typescript').Expression = expression;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
    }
    return ts.isIdentifier(current) ? current.text : undefined;
  };

  // True when an expression resolves to a verbatim slice of app source code (a "raw-source
  // carrier"), and is therefore not a permitted basis for a post-parse decision.
  const isRawSourceExpression = (expression: import('typescript').Expression): boolean => {
    const node = unwrapParens(ts, expression);
    // See through whitespace/case normalizers (`x.trim()`, `x.toLowerCase()`…) that preserve the
    // raw-source-ness of their receiver, so `arg.trim() === 'state'` is still flagged.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      stringNormalizerMethods.has(node.expression.name.text)
    ) {
      return isRawSourceExpression(node.expression.expression);
    }
    if (ts.isIdentifier(node)) return rawSourceIdentifierNames.has(node.text);
    if (ts.isElementAccessExpression(node)) {
      // An indexed element of a raw-source carrier is itself raw, e.g. `callArguments[index]` or
      // `zeroArgArrow.callArguments[index]`.
      return isRawSourceExpression(node.expression);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const propertyName = node.name.text;
      if (!rawSourcePropertyNames.has(propertyName)) return false;
      // Allow model-computed `.expression`/`.body` facts (candidate.expression, derive.expression…).
      const baseName = accessRootName(node.expression);
      return baseName === undefined || !computedFactReceiverNames.has(baseName);
    }
    return false;
  };

  // Allow IR-header provenance checks like `source.startsWith(compilerIrHeader)` — the argument is a
  // compiler-defined header constant, not a string-literal decision over app source.
  const isProvenanceHeaderArgument = (argument: import('typescript').Expression | undefined) =>
    argument !== undefined && ts.isIdentifier(argument) && argument.text.endsWith('IrHeader');

  const stringLiteralSide = (node: import('typescript').Expression) =>
    ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);

  const visit = (node: import('typescript').Node) => {
    // getText()/getFullText() on any node post-parse re-derives raw source.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;

      if (method === 'getText' || method === 'getFullText') {
        record(node, `post-parse ${method}() re-derives raw source`);
      }

      // Substring/prefix/suffix/equality decisions on a raw-source carrier.
      if (
        (method === 'includes' ||
          method === 'startsWith' ||
          method === 'endsWith' ||
          method === 'indexOf' ||
          method === 'search') &&
        isRawSourceExpression(receiver) &&
        !isProvenanceHeaderArgument(node.arguments[0])
      ) {
        record(node, `post-parse ${method}() decision over raw source`);
      }
    }

    // RegExp.test(<raw source>) and <raw source>.match(regExp).
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      if (method === 'test' && node.arguments.some((argument) => isRawSourceExpression(argument))) {
        record(node, 'post-parse regex .test() over raw source');
      }
      if (
        method === 'match' &&
        isRawSourceExpression(receiver) &&
        node.arguments.some((argument) => ts.isRegularExpressionLiteral(argument))
      ) {
        record(node, 'post-parse .match() over raw source');
      }
    }

    // Equality of a raw-source carrier against a string literal/template.
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)
    ) {
      const leftRaw = isRawSourceExpression(node.left);
      const rightRaw = isRawSourceExpression(node.right);
      if (
        (leftRaw && stringLiteralSide(node.right)) ||
        (rightRaw && stringLiteralSide(node.left))
      ) {
        record(node, 'post-parse equality of raw source against string literal');
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

function unwrapParens(
  ts: TypeScriptModule,
  expression: import('typescript').Expression,
): import('typescript').Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

async function projectFileTreeEntries(options: ProjectFileTreeOptions): Promise<string[]> {
  const entries = await readdir(join(options.rootPath, options.directory), {
    withFileTypes: true,
  });
  const paths: string[] = [];

  for (const entry of entries) {
    const path = `${options.directory}/${entry.name}`;

    if (entry.isDirectory()) {
      paths.push(...(await projectFileTreeEntries({ ...options, directory: path })));
    } else if (options.include?.(path) ?? true) {
      paths.push(path);
    }
  }

  return paths;
}
