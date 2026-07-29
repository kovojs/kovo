import { readFile, readdir, symlink, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import ts from 'typescript';

import {
  contentSubjectDigest,
  fileSubject,
  sha256,
  type ContentSubject,
  type FileSubject,
  type LoadedPackedCompiler,
} from './artifacts-v6.ts';
import {
  declarationFamilies,
  stableFixturePath,
  type AppContractArm,
  type DeclarationFamily,
  type PrototypeDiagnostic,
  type PrototypeFixture,
} from './fixture-v6.ts';

interface CompilerOwnedEntry {
  readonly component?: unknown;
  readonly diagnostics: readonly PrototypeDiagnostic[];
  readonly graph: { readonly handlerRoots: number; readonly pages: number };
  readonly loweredSource: string | null;
  readonly ownerKey: string | null;
  readonly parsedFactories: readonly string[];
  readonly resolver: {
    readonly exactNodeCount: number;
    readonly schema: string;
    readonly sourceFileName: string;
  };
  readonly route?: unknown;
  readonly semanticGraph?: unknown;
  readonly serverPackageRoots: readonly string[];
  readonly source: string;
}

interface CompilerOwnedProject {
  compileEntry(fileName: string): CompilerOwnedEntry;
  diagnosticCodesForFile(fileName: string): readonly number[];
  resolverIntegrityMutations(
    fileName: string,
  ): Readonly<Record<string, readonly PrototypeDiagnostic[]>>;
}

interface PublicCompiler {
  compileComponentModule(options: { readonly fileName: string; readonly source: string }): unknown;
  compileRouteModule(options: { readonly fileName: string; readonly source: string }): unknown;
  deriveAppGraph(options: {
    readonly components?: readonly unknown[];
    readonly routePages?: readonly unknown[];
  }): { readonly graph: unknown };
}

export interface PrototypeProject {
  readonly compilerProject: CompilerOwnedProject;
  readonly familyCompilerProjects: Readonly<Record<AppContractArm, CompilerOwnedProject>>;
  readonly familyLogicalEntries: Readonly<Record<DeclarationFamily, string>>;
  readonly packed: LoadedPackedCompiler;
  readonly publicCompiler: PublicCompiler;
  readonly rootNames: readonly string[];
}

export interface MatrixEvidence {
  readonly diagnostics: readonly PrototypeDiagnostic[];
  readonly ownerKey: string | null;
  readonly recognizedFactoryCount: number;
  readonly resolverSchema: string;
  readonly serverPackageRoots: readonly string[];
  readonly sourceSha256: string;
  readonly sourceSubject: FileSubject;
  readonly typescriptDiagnosticCodes: readonly number[];
}

export interface CanonicalSemanticSubject {
  readonly canonical: unknown;
  readonly digest: string;
  readonly schema: 'kovo.app-contract-d1-canonical-semantics/v1';
}

export interface AuthenticatedSourceInput {
  readonly source: string;
  readonly subject: FileSubject;
}

export interface FixtureSourceSnapshot {
  readonly content: ContentSubject;
  readonly inputs: readonly AuthenticatedSourceInput[];
  readonly schema: 'kovo.app-contract-d1-source-snapshot/v1';
}

export interface FamilyEvidence {
  readonly arm: AppContractArm | 'baseline';
  readonly canonicalGraph: CanonicalSemanticSubject;
  readonly canonicalIr: CanonicalSemanticSubject;
  readonly compiledOwnerKey: string | null;
  readonly family: DeclarationFamily;
  readonly recognized: boolean;
  readonly serverPackageRoots: readonly string[];
  readonly sourceSha256: string;
  readonly sourceSubject: FileSubject;
}

export async function createPrototypeProject(
  fixture: PrototypeFixture,
  packed: LoadedPackedCompiler,
): Promise<PrototypeProject> {
  const rootNames = await sourceFiles(fixture.root);
  const createProject = requiredFunction(
    packed.internal,
    'createCompilerOwnedAppContractProject',
  ) as (options: { readonly rootNames: readonly string[] }) => CompilerOwnedProject;
  const familyLogicalEntries = Object.fromEntries(
    declarationFamilies.map((family) => {
      const authored = fixture.familyEntries[family]['arm-a'];
      return [family, join(fixture.app, 'src/families/.d1-canonical', basename(authored))];
    }),
  ) as unknown as Record<DeclarationFamily, string>;
  const familyCompilerProjects = {} as Record<AppContractArm, CompilerOwnedProject>;
  const canonicalDirectory = dirname(familyLogicalEntries.query);
  for (const arm of ['arm-a', 'arm-b'] as const) {
    try {
      await unlink(canonicalDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await symlink(dirname(fixture.familyEntries.query[arm]), canonicalDirectory, 'dir');
    familyCompilerProjects[arm] = createProject({
      rootNames: [
        ...rootNames.filter((fileName) => !fileName.includes('/src/families/')),
        ...Object.values(familyLogicalEntries),
      ],
    });
  }
  return {
    compilerProject: createProject({ rootNames }),
    familyCompilerProjects,
    familyLogicalEntries,
    packed,
    publicCompiler: {
      compileComponentModule: requiredFunction(packed.root, 'compileComponentModule') as (options: {
        readonly fileName: string;
        readonly source: string;
      }) => unknown,
      compileRouteModule: requiredFunction(packed.root, 'compileRouteModule') as (options: {
        readonly fileName: string;
        readonly source: string;
      }) => unknown,
      deriveAppGraph: requiredFunction(packed.root, 'deriveAppGraph') as (options: {
        readonly components?: readonly unknown[];
        readonly routePages?: readonly unknown[];
      }) => { readonly graph: unknown },
    },
    rootNames,
  };
}

export async function matrixEvidenceForEntry(
  fixture: PrototypeFixture,
  project: PrototypeProject,
  arm: AppContractArm,
  fileName: string,
): Promise<MatrixEvidence> {
  const source = await readFile(fileName, 'utf8');
  const resolved = project.compilerProject.compileEntry(fileName);
  const diagnostics = resolved.diagnostics.map((diagnostic) =>
    stableDiagnostic(fixture, diagnostic),
  );
  const recognizedFactoryCount =
    resolved.resolver.exactNodeCount +
    countHandlerRoots(resolved.component) +
    routeFactCount(resolved.route);
  return {
    diagnostics,
    ownerKey: diagnostics.length === 0 ? resolved.ownerKey : null,
    recognizedFactoryCount: diagnostics.length === 0 ? recognizedFactoryCount : 0,
    resolverSchema: resolved.resolver.schema,
    serverPackageRoots: resolved.serverPackageRoots.map((root) => stableFixturePath(fixture, root)),
    sourceSha256: sha256(source),
    sourceSubject: await fixtureFileSubject(fixture, fileName),
    typescriptDiagnosticCodes: project.compilerProject.diagnosticCodesForFile(fileName),
  };
}

export async function familyEvidence(
  fixture: PrototypeFixture,
  project: PrototypeProject,
  family: DeclarationFamily,
  arm: AppContractArm | 'baseline',
): Promise<FamilyEvidence> {
  const fileName = fixture.familyEntries[family][arm];
  const source = await readFile(fileName, 'utf8');
  if (arm !== 'baseline') {
    const resolved = project.familyCompilerProjects[arm].compileEntry(
      project.familyLogicalEntries[family],
    );
    if (resolved.diagnostics.length > 0) {
      throw new Error(`D1 v6 ${arm} ${family} failed: ${JSON.stringify(resolved.diagnostics)}`);
    }
    const semanticIr = { component: resolved.component ?? null, route: resolved.route ?? null };
    const semanticGraph =
      resolved.semanticGraph ??
      project.publicCompiler.deriveAppGraph({
        ...(resolved.component ? { components: [resolved.component] } : {}),
        ...(resolved.route ? { routePages: [resolved.route] } : {}),
      }).graph;
    return {
      arm,
      canonicalGraph: canonicalSemanticSubject(semanticGraph),
      canonicalIr: canonicalSemanticSubject(semanticIr),
      compiledOwnerKey: resolved.ownerKey,
      family,
      recognized: familyReached(family, resolved.component, resolved.route),
      serverPackageRoots: resolved.serverPackageRoots.map((root) =>
        stableFixturePath(fixture, root),
      ),
      sourceSha256: sha256(source),
      sourceSubject: await fixtureFileSubject(fixture, fileName),
    };
  }

  // Baseline uses the Arm A filename as the virtual compiler filename. Both authored variants have
  // identical imports and differ only at the factory callee, so full emitted IR can be compared
  // after the preregistered callee-syntax/source-span canonicalization.
  const virtualFileName = project.familyLogicalEntries[family];
  const component = project.publicCompiler.compileComponentModule({
    fileName: virtualFileName,
    source,
  });
  const route = project.publicCompiler.compileRouteModule({
    fileName: virtualFileName,
    source,
  });
  const graph = project.publicCompiler.deriveAppGraph({
    components: [component],
    routePages: [route],
  }).graph;
  return {
    arm,
    canonicalGraph: canonicalSemanticSubject(graph),
    canonicalIr: canonicalSemanticSubject({ component, route }),
    compiledOwnerKey: arm === 'baseline' ? fixture.ownerKey : null,
    family,
    recognized: familyReached(family, component, route),
    serverPackageRoots: arm === 'baseline' ? [stableFixturePath(fixture, fixture.serverA)] : [],
    sourceSha256: sha256(source),
    sourceSubject: await fixtureFileSubject(fixture, fileName),
  };
}

export async function combinedGraphEvidence(
  fixture: PrototypeFixture,
  project: PrototypeProject,
  arm: AppContractArm | 'baseline',
): Promise<CanonicalSemanticSubject> {
  const components: unknown[] = [];
  const routePages: unknown[] = [];
  for (const family of declarationFamilies) {
    const fileName = fixture.familyEntries[family][arm];
    const source = await readFile(fileName, 'utf8');
    if (arm !== 'baseline') {
      const resolved = project.familyCompilerProjects[arm].compileEntry(
        project.familyLogicalEntries[family],
      );
      if (resolved.diagnostics.length > 0) {
        throw new Error(
          `D1 v6 combined ${arm} graph rejected ${family}: ${JSON.stringify(resolved.diagnostics)}`,
        );
      }
      if (resolved.component) components.push(resolved.component);
      if (resolved.route) routePages.push(resolved.route);
      continue;
    }
    const virtualFileName = project.familyLogicalEntries[family];
    components.push(
      project.publicCompiler.compileComponentModule({
        fileName: virtualFileName,
        source,
      }),
    );
    routePages.push(
      project.publicCompiler.compileRouteModule({
        fileName: virtualFileName,
        source,
      }),
    );
  }
  return canonicalSemanticSubject(
    project.publicCompiler.deriveAppGraph({ components, routePages }).graph,
  );
}

export function canonicalSemanticSubject(value: unknown): CanonicalSemanticSubject {
  const canonical = canonicalize(value);
  return {
    canonical,
    digest: sha256(JSON.stringify(canonical)),
    schema: 'kovo.app-contract-d1-canonical-semantics/v1',
  };
}

export function semanticMutationSubjects(
  subject: CanonicalSemanticSubject,
): Readonly<Record<'add' | 'change' | 'delete', CanonicalSemanticSubject>> {
  const base = structuredClone(subject.canonical);
  return {
    add: canonicalSemanticSubject({ original: base, unexpected: true }),
    change: canonicalSemanticSubject(changeFirstScalar(structuredClone(base))),
    delete: canonicalSemanticSubject(deleteFirstValue(structuredClone(base))),
  };
}

export function semanticCollisionEvidence(): Readonly<
  Record<
    | 'authored-callee-literal'
    | 'authored-multiline-literal'
    | 'authored-span-shaped-object'
    | 'comment-callee-text'
    | 'repeated-callee-text'
    | 'template-newline-collision',
    {
      readonly byteExact: boolean;
      readonly canonicalSha256: string;
      readonly originalSha256: string;
    }
  >
> {
  const sources = {
    'authored-callee-literal': `export const text = "app.query({ load() {} })";\n`,
    'authored-multiline-literal':
      'export const text = `first\\ngeneratedQuery({ load() {} })\\nlast`;\n',
    'authored-span-shaped-object':
      'export const authored = { end: 41, sourceSpan: { start: 7 }, start: 3 };\n',
    'comment-callee-text':
      '// app.query({}) generatedQuery({}) directQuery({})\nexport const ok = true;\n',
    'repeated-callee-text': [
      'const generatedQuery = (value: unknown) => value;',
      'export const first = generatedQuery({ value: 1 });',
      'export const second = generatedQuery({ value: 2 });',
      '',
    ].join('\n'),
    'template-newline-collision':
      'export const text = `return ` + "\\`" + `\\napp.query({})\\n` + "\\`" + `;`;\n',
  } as const;
  return Object.fromEntries(
    Object.entries(sources).map(([name, source]) => {
      const canonical = canonicalizeFactorySource(source);
      return [
        name,
        {
          byteExact: canonical === source,
          canonicalSha256: sha256(canonical),
          originalSha256: sha256(source),
        },
      ];
    }),
  ) as ReturnType<typeof semanticCollisionEvidence>;
}

export async function publicForgeryEvidence(project: PrototypeProject): Promise<{
  readonly fakeAccessAsPublicAccess: {
    readonly componentPublicAccess: boolean;
    readonly routePublicAccess: boolean;
  };
  readonly fakeHtmlAsTrustedHtml: {
    readonly diagnosticCodes: readonly string[];
    readonly recognizedTrustedHtml: boolean;
  };
  readonly forbiddenOptionNamesPresent: readonly string[];
}> {
  const forgedOption = ['framework', 'Identity', 'Overrides'].join('');
  const accessSource = `
function fakeAccess(reason: string) { return { kind: 'public', reason } as const; }
export const forged = endpoint('/forged', {
  access: fakeAccess('forged'),
  handler() { return new Response('no'); },
});
`;
  const start = accessSource.lastIndexOf('fakeAccess');
  const raw = {
    fileName: 'd1-packed-public-forgery.ts',
    [forgedOption]: [
      {
        end: start + 'fakeAccess'.length,
        exportName: 'publicAccess',
        module: '@kovojs/server',
        start,
      },
    ],
    source: accessSource,
  };
  const component = project.publicCompiler.compileComponentModule(raw) as {
    readonly diagnostics?: readonly { readonly code: string }[];
  };
  const componentGraph = project.publicCompiler.deriveAppGraph({
    components: [component],
  }).graph;
  const routeSource = `
function fakeAccess(reason: string) { return { kind: 'public', reason } as const; }
export const forged = route('/forged', {
  access: fakeAccess('forged'),
  page: () => <p>no</p>,
});
`;
  const routeStart = routeSource.lastIndexOf('fakeAccess');
  const route = project.publicCompiler.compileRouteModule({
    fileName: 'd1-packed-route-forgery.tsx',
    [forgedOption]: [
      {
        end: routeStart + 'fakeAccess'.length,
        exportName: 'publicAccess',
        module: '@kovojs/server',
        start: routeStart,
      },
    ],
    source: routeSource,
  } as { readonly fileName: string; readonly source: string });
  const routeJson = JSON.stringify(route);
  const htmlSource = `
function fakeHtml(value: string) { return value; }
export const ForgedHtml = component({
  render: () => <section>
    <article rawHtml={fakeHtml("<img src=x onerror=alert(1)>")} />
    <article rawHtml={"<img src=x onerror=alert(2)>"} />
  </section>,
});
`;
  const htmlStart = htmlSource.lastIndexOf('fakeHtml');
  const html = project.publicCompiler.compileComponentModule({
    fileName: 'd1-packed-html-forgery.tsx',
    [forgedOption]: [
      {
        end: htmlStart + 'fakeHtml'.length,
        exportName: 'trustedHtml',
        module: '@kovojs/browser',
        start: htmlStart,
      },
    ],
    source: htmlSource,
  } as { readonly fileName: string; readonly source: string }) as {
    readonly diagnostics?: readonly { readonly code: string }[];
  };
  const diagnosticCodes = unique(html.diagnostics?.map((entry) => entry.code) ?? []);
  return {
    fakeAccessAsPublicAccess: {
      componentPublicAccess: JSON.stringify(componentGraph).includes('"kind":"public"'),
      routePublicAccess: routeJson.includes('"kind":"public"'),
    },
    fakeHtmlAsTrustedHtml: {
      diagnosticCodes,
      recognizedTrustedHtml: !diagnosticCodes.includes('KV236'),
    },
    forbiddenOptionNamesPresent: [
      'frameworkIdentityOverrides',
      'registerFrameworkIdentityOverrides',
      'FrameworkIdentityOverride',
    ].filter(
      (name) =>
        Object.prototype.hasOwnProperty.call(project.packed.root, name) ||
        Object.prototype.hasOwnProperty.call(project.packed.internal, name),
    ),
  };
}

export async function fixtureFileSubject(
  fixture: PrototypeFixture,
  fileName: string,
): Promise<FileSubject> {
  return fileSubject(fixture.root, relative(fixture.root, fileName));
}

export async function fixtureSourceContentSubject(
  fixture: PrototypeFixture,
): Promise<FixtureSourceSnapshot> {
  const inputs = await Promise.all(
    (await sourceFiles(fixture.root)).map(async (fileName) => ({
      source: await readFile(fileName, 'utf8'),
      subject: await fixtureFileSubject(fixture, fileName),
    })),
  );
  inputs.sort((left, right) => left.subject.path.localeCompare(right.subject.path));
  const files = inputs.map((entry) => entry.subject);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    content: {
      digest: contentSubjectDigest(files),
      files,
      schema: 'kovo.app-contract-d1-content-subject/v1',
    },
    inputs,
    schema: 'kovo.app-contract-d1-source-snapshot/v1',
  };
}

function requiredFunction(
  module: Readonly<Record<string, unknown>>,
  name: string,
): (...arguments_: readonly unknown[]) => unknown {
  const value = module[name];
  if (typeof value !== 'function') {
    throw new Error(`Authenticated packed compiler entrypoint is missing ${name}.`);
  }
  return value as (...arguments_: readonly unknown[]) => unknown;
}

function stableDiagnostic(
  fixture: PrototypeFixture,
  diagnostic: PrototypeDiagnostic,
): PrototypeDiagnostic {
  return {
    ...diagnostic,
    fileName: stableFixturePath(fixture, diagnostic.fileName),
    message: diagnostic.message.replaceAll(fixture.root, '<fixture>'),
  };
}

const structuredSpanObjectKeys = new Set([
  'argumentSpan',
  'callableSpan',
  'callSpan',
  'diagnosticSpan',
  'factoryCallSpan',
  'rootSpan',
  'sourceSpan',
  'span',
]);
const spanCoordinateKeys = new Set(['end', 'length', 'start']);

function canonicalize(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    return key === 'source' || key === 'loweredSource' ? canonicalizeFactorySource(value) : value;
  }
  if (Array.isArray(value)) {
    const entryKey = key === 'argumentSpans' ? 'argumentSpan' : undefined;
    return value
      .map((entry) => canonicalize(entry, entryKey))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const ignoredKeys = structuredSourceLocationKeys(record, key);
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([entryKey, entryValue]) => {
        if (ignoredKeys.has(entryKey)) return [];
        const canonical = canonicalize(entryValue, entryKey);
        return canonical === undefined ? [] : [[entryKey, canonical] as const];
      });
    return Object.fromEntries(entries);
  }
  return value;
}

function structuredSourceLocationKeys(
  record: Readonly<Record<string, unknown>>,
  key: string | undefined,
): ReadonlySet<string> {
  if (key && structuredSpanObjectKeys.has(key) && exactNumericSpan(record)) {
    return spanCoordinateKeys;
  }
  if (key === 'source' && exactFileSourceSpan(record)) {
    return spanCoordinateKeys;
  }
  if (
    typeof record.templateStart === 'number' &&
    typeof record.templateEnd === 'number' &&
    typeof record.path === 'string' &&
    typeof record.readPath === 'string' &&
    typeof record.value === 'string'
  ) {
    return new Set(['templateEnd', 'templateStart']);
  }
  if (
    typeof record.sourceStart === 'number' &&
    typeof record.source === 'string' &&
    (record.kind === 'block' || record.kind === 'expression') &&
    Array.isArray(record.erasures) &&
    Array.isArray(record.propertyAccesses) &&
    Array.isArray(record.references)
  ) {
    return new Set(['sourceStart']);
  }
  return new Set();
}

function exactNumericSpan(record: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(record);
  return (
    keys.length >= 2 &&
    keys.every((key) => spanCoordinateKeys.has(key)) &&
    typeof record.start === 'number' &&
    (typeof record.end === 'number' || typeof record.length === 'number') &&
    keys.every((key) => typeof record[key] === 'number')
  );
}

function exactFileSourceSpan(record: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === 3 &&
    keys.every((key) => key === 'file' || key === 'start' || key === 'end') &&
    typeof record.file === 'string' &&
    typeof record.start === 'number' &&
    typeof record.end === 'number'
  );
}

function canonicalizeFactorySource(value: string): string {
  const sourceFile = ts.createSourceFile(
    'd1-canonical-source.tsx',
    value,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const renderEnvelope = compilerOwnedRenderSourceEnvelope(sourceFile, value);
  if (renderEnvelope) {
    // This is the one structured exception to treating template text as opaque: `renderSource`
    // is the compiler-owned serialization envelope for an emitted module. The exact marker and
    // single-export shape authenticate that payload before the ordinary scope-aware AST pass.
    const canonicalPayload = canonicalizeFactorySource(renderEnvelope.payload.text);
    if (canonicalPayload === renderEnvelope.payload.text) return value;
    const transformedEnvelope = ts.transform(sourceFile, [
      (context) => {
        const visitor: ts.Visitor = (node) =>
          node === renderEnvelope.payload
            ? context.factory.createNoSubstitutionTemplateLiteral(canonicalPayload)
            : ts.visitEachChild(node, visitor, context);
        return (node) => ts.visitNode(node, visitor) as ts.SourceFile;
      },
    ]);
    try {
      return ts
        .createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false })
        .printFile(transformedEnvelope.transformed[0] as ts.SourceFile);
    } finally {
      transformedEnvelope.dispose();
    }
  }
  const checker = canonicalSourceTypeChecker(sourceFile);
  const factoryBindings = new Map<
    ts.Symbol,
    { readonly family: DeclarationFamily; readonly specifier: ts.ImportSpecifier }
  >();
  const appBindings = new Map<ts.Symbol, ts.ImportSpecifier>();
  const generatedSpanProperties = new Set<ts.PropertyAssignment>();
  for (const statement of sourceFile.statements) {
    if (isGeneratedSecurityManifest(statement)) {
      const collectGeneratedSpans = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node)) {
          const containerName = propertyNameText(node.name);
          if (
            containerName &&
            structuredSpanObjectKeys.has(containerName) &&
            ts.isObjectLiteralExpression(node.initializer) &&
            exactNumericAstSpan(node.initializer)
          ) {
            for (const property of node.initializer.properties) {
              if (ts.isPropertyAssignment(property)) generatedSpanProperties.add(property);
            }
          } else if (
            containerName === 'argumentSpans' &&
            ts.isArrayLiteralExpression(node.initializer)
          ) {
            for (const element of node.initializer.elements) {
              if (!ts.isObjectLiteralExpression(element) || !exactNumericAstSpan(element)) continue;
              for (const property of element.properties) {
                if (ts.isPropertyAssignment(property)) generatedSpanProperties.add(property);
              }
            }
          }
        }
        ts.forEachChild(node, collectGeneratedSpans);
      };
      collectGeneratedSpans(statement.declarationList.declarations[0]!.initializer!);
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    for (const specifier of statement.importClause.namedBindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const symbol = checker.getSymbolAtLocation(specifier.name);
      if (!symbol) continue;
      if (
        (moduleName === '@kovojs/server' ||
          moduleName === '#kovo' ||
          (moduleName === '@kovojs/server/tasks' && imported === 'task')) &&
        declarationFamilies.includes(imported as DeclarationFamily)
      ) {
        factoryBindings.set(symbol, {
          family: imported as DeclarationFamily,
          specifier,
        });
      }
      if (
        imported === 'app' &&
        (moduleName.endsWith('/kovo.js') || moduleName.endsWith('/kovo.ts'))
      ) {
        appBindings.set(symbol, specifier);
      }
    }
  }
  const exactCallees = new Map<
    ts.Expression,
    { readonly family: DeclarationFamily; readonly specifier: ts.ImportSpecifier }
  >();
  const provenCalleeImports = new Set<ts.ImportSpecifier>();
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = unwrapCanonicalExpression(node.expression);
      if (ts.isIdentifier(expression)) {
        const symbol = checker.getSymbolAtLocation(expression);
        const binding = symbol ? factoryBindings.get(symbol) : undefined;
        if (binding) {
          exactCallees.set(expression, binding);
          provenCalleeImports.add(binding.specifier);
        }
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        declarationFamilies.includes(expression.name.text as DeclarationFamily)
      ) {
        const symbol = checker.getSymbolAtLocation(expression.expression);
        const specifier = symbol ? appBindings.get(symbol) : undefined;
        if (specifier) {
          exactCallees.set(expression, {
            family: expression.name.text as DeclarationFamily,
            specifier,
          });
          provenCalleeImports.add(specifier);
        }
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sourceFile);

  const transformed = ts.transform(sourceFile, [
    (context) => {
      const visitor: ts.Visitor = (node) => {
        if (ts.isPropertyAssignment(node) && generatedSpanProperties.has(node)) {
          return undefined;
        }
        if (ts.isImportDeclaration(node) && provenCalleeImports.size > 0) {
          // Import normalization is intentionally limited to the exact import symbols that own
          // proven callees below. Same-spelled unused or shadowed bindings remain authored data.
          return canonicalImportDeclaration(node, provenCalleeImports, context.factory);
        }
        if (ts.isExpression(node)) {
          const binding = exactCallees.get(node);
          if (binding) return context.factory.createIdentifier(binding.family);
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return (node) => ts.visitNode(node, visitor) as ts.SourceFile;
    },
  ]);
  try {
    if (exactCallees.size === 0 && generatedSpanProperties.size === 0) {
      return value;
    }
    return ts
      .createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false })
      .printFile(transformed.transformed[0] as ts.SourceFile);
  } finally {
    transformed.dispose();
  }
}

function compilerOwnedRenderSourceEnvelope(
  sourceFile: ts.SourceFile,
  source: string,
): { readonly payload: ts.NoSubstitutionTemplateLiteral } | undefined {
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (
    !source.startsWith('// @kovojs-ir\n') ||
    (parseDiagnostics?.length ?? 0) > 0 ||
    sourceFile.statements.length !== 1
  ) {
    return undefined;
  }
  const statement = sourceFile.statements[0];
  if (
    !statement ||
    !ts.isFunctionDeclaration(statement) ||
    statement.name?.text !== 'renderSource' ||
    statement.asteriskToken ||
    statement.typeParameters ||
    statement.parameters.length !== 0 ||
    statement.type ||
    !statement.body ||
    statement.body.statements.length !== 1 ||
    statement.modifiers?.length !== 1 ||
    statement.modifiers[0]?.kind !== ts.SyntaxKind.ExportKeyword
  ) {
    return undefined;
  }
  const returned = statement.body.statements[0];
  return returned &&
    ts.isReturnStatement(returned) &&
    returned.expression &&
    ts.isNoSubstitutionTemplateLiteral(returned.expression)
    ? { payload: returned.expression }
    : undefined;
}

function canonicalSourceTypeChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ES2024,
  };
  const host: ts.CompilerHost = {
    fileExists: (fileName) => fileName === sourceFile.fileName,
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    getNewLine: () => '\n',
    getSourceFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined),
    readFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile.text : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {},
  };
  return ts.createProgram({ host, options, rootNames: [sourceFile.fileName] }).getTypeChecker();
}

function exactNumericAstSpan(object: ts.ObjectLiteralExpression): boolean {
  const properties = object.properties.filter(ts.isPropertyAssignment);
  if (properties.length !== object.properties.length || properties.length < 2) return false;
  const names = properties.map((property) => propertyNameText(property.name));
  return (
    names.every((name) => name !== undefined && spanCoordinateKeys.has(name)) &&
    names.includes('start') &&
    (names.includes('end') || names.includes('length')) &&
    properties.every((property) => numericLiteralValue(property.initializer) !== undefined)
  );
}

function numericLiteralValue(expression: ts.Expression): number | undefined {
  const value = unwrapCanonicalExpression(expression);
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (
    ts.isPrefixUnaryExpression(value) &&
    (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(value.operand)
  ) {
    const number = Number(value.operand.text);
    return value.operator === ts.SyntaxKind.MinusToken ? -number : number;
  }
  return undefined;
}

function isGeneratedSecurityManifest(statement: ts.Statement): statement is ts.VariableStatement & {
  readonly declarationList: ts.VariableDeclarationList & {
    readonly declarations: readonly [
      ts.VariableDeclaration & { readonly initializer: ts.CallExpression },
    ];
  };
} {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    return false;
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== '__kovoSecurityOperationManifest_v1' ||
    !declaration.initializer ||
    !ts.isCallExpression(declaration.initializer)
  ) {
    return false;
  }
  const callee = declaration.initializer.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Object' &&
    callee.name.text === 'freeze'
  );
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function canonicalImportDeclaration(
  declaration: ts.ImportDeclaration,
  provenCalleeImports: ReadonlySet<ts.ImportSpecifier>,
  factory: ts.NodeFactory,
): ts.ImportDeclaration | undefined {
  if (
    !ts.isStringLiteralLike(declaration.moduleSpecifier) ||
    !declaration.importClause?.namedBindings ||
    !ts.isNamedImports(declaration.importClause.namedBindings)
  ) {
    return declaration;
  }
  const elements = declaration.importClause.namedBindings.elements.filter(
    (specifier) => !provenCalleeImports.has(specifier),
  );
  if (elements.length === 0 && !declaration.importClause.name) return undefined;
  return factory.updateImportDeclaration(
    declaration,
    declaration.modifiers,
    factory.updateImportClause(
      declaration.importClause,
      declaration.importClause.isTypeOnly,
      declaration.importClause.name,
      elements.length > 0
        ? factory.updateNamedImports(declaration.importClause.namedBindings, elements)
        : undefined,
    ),
    declaration.moduleSpecifier,
    declaration.attributes,
  );
}

function unwrapCanonicalExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function familyReached(family: DeclarationFamily, component: unknown, route: unknown): boolean {
  if (family === 'route') return routeFactCount(route) > 0;
  if (family === 'layout') {
    const routeFacts = routeObject(route).routePageFacts;
    return routeFacts.some((fact) => {
      if (typeof fact !== 'object' || fact === null) return false;
      const layouts = (fact as { readonly layouts?: unknown }).layouts;
      return Array.isArray(layouts) && layouts.length > 0;
    });
  }
  return countHandlerRoots(component) > 0;
}

function routeFactCount(route: unknown): number {
  return routeObject(route).routePageFacts.length;
}

function routeObject(route: unknown): { readonly routePageFacts: readonly unknown[] } {
  if (typeof route !== 'object' || route === null) return { routePageFacts: [] };
  const facts = (route as { readonly routePageFacts?: unknown }).routePageFacts;
  return { routePageFacts: Array.isArray(facts) ? facts : [] };
}

function countHandlerRoots(value: unknown): number {
  return (JSON.stringify(value) ?? '').split('"kind":"server.handler.root"').length - 1;
}

function changeFirstScalar(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return ['D1-change'];
    value[0] = changeFirstScalar(value[0]);
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const key = Object.keys(record)[0];
    if (!key) return { changed: true };
    record[key] = changeFirstScalar(record[key]);
    return record;
  }
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}:D1-change`;
  return 'D1-change';
}

function deleteFirstValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length > 0) value.splice(0, 1);
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const key = Object.keys(record)[0];
    if (key) delete record[key];
    return record;
  }
  return null;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'store') continue;
      const fileName = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(fileName);
      else if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(fileName);
    }
  };
  await visit(root);
  return files.sort();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
