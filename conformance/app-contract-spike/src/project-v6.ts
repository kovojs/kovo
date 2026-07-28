import { readFile, readdir, symlink, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import {
  fileSubject,
  sha256,
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

function canonicalize(value: unknown, key?: string): unknown {
  if (spanKey(key)) return undefined;
  if (typeof value === 'string') return normalizeCalleeSyntax(value);
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry)).filter((entry) => entry !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([entryKey, entryValue]) => {
        const canonical = canonicalize(entryValue, entryKey);
        return canonical === undefined ? [] : [[entryKey, canonical] as const];
      });
    return Object.fromEntries(entries);
  }
  return value;
}

function spanKey(key: string | undefined): boolean {
  return (
    key === 'end' ||
    key === 'length' ||
    key === 'sourceSpan' ||
    key === 'sourceStart' ||
    key === 'start' ||
    key === 'templateEnd' ||
    key === 'templateStart'
  );
}

function normalizeCalleeSyntax(value: string): string {
  let normalized = value
    .replaceAll(/import \{ app \} from ['"][^'"]+['"];\n?/gu, '')
    .replaceAll(/import \{ ([^}]+) \} from '@kovojs\/server';/gu, (_match, rawNames: string) => {
      const names = rawNames
        .split(',')
        .map((name) => name.trim())
        .filter(
          (name) => name.length > 0 && !(declarationFamilies as readonly string[]).includes(name),
        );
      return names.length > 0 ? `import { ${names.join(', ')} } from '@kovojs/server';` : '';
    })
    .replaceAll(/import \{ ([^}]+) \} from '#kovo';\n?/gu, (_match, rawNames: string) => {
      const names = rawNames
        .split(',')
        .map((name) => name.trim())
        .filter((name) => {
          const imported = name.split(/\s+as\s+/u)[0];
          return imported !== undefined && !declarationFamilies.includes(imported as DeclarationFamily);
        });
      return names.length > 0 ? `import { ${names.join(', ')} } from '#kovo';` : '';
    })
    .replaceAll(/"end":\d+/gu, '"end":0')
    .replaceAll(/"start":\d+/gu, '"start":0')
    .replaceAll(
      '/** @jsxImportSource @kovojs/server */\n\n',
      '/** @jsxImportSource @kovojs/server */\n',
    );
  for (const family of declarationFamilies) {
    const title = `${family[0]!.toUpperCase()}${family.slice(1)}`;
    normalized = normalized
      .replaceAll(`app.${family}`, family)
      .replaceAll(`direct${title}(`, `${family}(`)
      .replaceAll(`generated${title}(`, `${family}(`);
  }
  normalized = normalized.replaceAll('return `\n', 'return `').replaceAll(/\n{3,}/gu, '\n\n');
  return normalized.startsWith('\n') ? normalized.slice(1) : normalized;
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
