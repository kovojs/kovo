import { execFileSync, type ExecFileSyncOptionsWithBufferEncoding } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

function resolveBin(name: string): string {
  return join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
}

function execFileSyncWithDiagnostics(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithBufferEncoding,
): void {
  try {
    execFileSync(file, [...args], options);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
    const stdout = (error as { stdout?: Buffer }).stdout?.toString('utf8') ?? '';
    throw new Error([stdout, stderr].filter(Boolean).join('\n'));
  }
}

const declarationFixtureDirectory = join(
  process.cwd(),
  'packages/server/type-fixtures/app-contract',
);
const declarationConfigPath = join(declarationFixtureDirectory, 'tsconfig.json');
const canonicalDeclarationImports = new Set([
  '@kovojs/core',
  '@kovojs/server',
  '@kovojs/server/custom-adapters',
]);
const privateDeclarationNames = new Set([
  'appDeclarationHandleBrand',
  'appOptimisticBindingBrand',
  'componentHandleWitness',
  'kovoAppTokenBrand',
  'kovoContractBrand',
  'mutationFormDefinitionBrand',
  'readerDbBrand',
]);

interface PublicTypeExpectation {
  specifier: string;
  symbol: string;
}

function emitDeclarationFixture(fixtureName: string): string {
  const source = readFileSync(join(declarationFixtureDirectory, fixtureName), 'utf8');
  // Materialize outside @kovojs/server so TypeScript resolves the same package-public names that a
  // downstream declaration-emitting package sees, rather than same-package relative source paths.
  const consumerRoot = mkdtempSync(
    join(process.cwd(), 'packages/test/.tmp-app-contract-nameability-'),
  );
  const consumerPath = join(consumerRoot, fixtureName);
  writeFileSync(consumerPath, source, 'utf8');

  try {
    const config = ts.readConfigFile(declarationConfigPath, ts.sys.readFile);
    if (config.error !== undefined) {
      throw new Error(formatTypeScriptDiagnostics([config.error]));
    }
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(declarationConfigPath),
    );
    const { tsBuildInfoFile: _tsBuildInfoFile, ...parsedOptions } = parsed.options;
    const options: ts.CompilerOptions = {
      ...parsedOptions,
      allowImportingTsExtensions: true,
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      incremental: false,
      noEmit: false,
      noEmitOnError: true,
    };
    const program = ts.createProgram({ options, rootNames: [consumerPath] });
    const output = new Map<string, string>();
    const emit = program.emit(
      undefined,
      (fileName, text) => output.set(fileName, text),
      undefined,
      true,
    );
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
    if (diagnostics.length > 0) {
      throw new Error(formatTypeScriptDiagnostics(diagnostics));
    }

    const declarationName = basename(fixtureName).replace(/\.ts$/u, '.d.ts');
    const emitted = [...output].find(([fileName]) => basename(fileName) === declarationName)?.[1];
    if (emitted === undefined) {
      throw new Error(`TypeScript did not emit ${declarationName}.`);
    }
    return emitted;
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function formatTypeScriptDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

function declarationImportSpecifier(node: ts.ImportTypeNode): string | undefined {
  return ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
    ? node.argument.literal.text
    : undefined;
}

function exportedVariableTypes(source: ts.SourceFile): Map<string, ts.TypeNode> {
  const exported = new Map<string, ts.TypeNode>();
  for (const statement of source.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.type !== undefined) {
        exported.set(declaration.name.text, declaration.type);
      }
    }
  }
  return exported;
}

function auditDeclarationOutput(output: string): string[] {
  const source = ts.createSourceFile(
    'app-contract-nameability.d.ts',
    output,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings: string[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) findings.push('public declaration contains any');
    if (ts.isIdentifier(node) && privateDeclarationNames.has(node.text)) {
      findings.push(`public declaration expands private witness ${node.text}`);
    }
    if (ts.isImportTypeNode(node)) {
      const specifier = declarationImportSpecifier(node);
      if (specifier === undefined || !canonicalDeclarationImports.has(specifier)) {
        findings.push(`public declaration imports non-public module ${specifier ?? '<unknown>'}`);
      }
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !canonicalDeclarationImports.has(node.moduleSpecifier.text)
    ) {
      findings.push(`public declaration imports non-public module ${node.moduleSpecifier.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const [name, type] of exportedVariableTypes(source)) {
    if (ts.isTypeLiteralNode(type)) {
      findings.push(`export ${name} expands an anonymous top-level handle`);
    }
  }
  return [...new Set(findings)].sort();
}

function expectPublicHandleTypes(
  output: string,
  expectations: Readonly<Record<string, PublicTypeExpectation>>,
): Map<string, ts.TypeNode> {
  const source = ts.createSourceFile(
    'app-contract-nameability.d.ts',
    output,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exported = exportedVariableTypes(source);
  for (const [name, expectation] of Object.entries(expectations)) {
    const type = exported.get(name);
    expect(type, `missing emitted type for ${name}`).toBeDefined();
    expect(ts.isImportTypeNode(type!), `${name} must name a package-public type`).toBe(true);
    if (!ts.isImportTypeNode(type!)) continue;
    expect(declarationImportSpecifier(type!)).toBe(expectation.specifier);
    expect(type!.qualifier?.getText(source)).toBe(expectation.symbol);
  }
  return exported;
}

describe('app-contract public type fixtures', () => {
  it('checks positive inference and every expected unsafe/renamed call shape', () => {
    expect(() =>
      execFileSyncWithDiagnostics(
        resolveBin('tsc'),
        [
          '-p',
          join(process.cwd(), 'packages/server/type-fixtures/app-contract/tsconfig.json'),
          '--incremental',
          'false',
          '--pretty',
          'false',
        ],
        {
          cwd: process.cwd(),
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });

  it('anchors an unknown query property locally within the D1 diagnostic-size budget', () => {
    const fixtureSource = readFileSync(
      join(process.cwd(), 'packages/server/type-fixtures/app-contract/diagnostic-query.ts.fixture'),
      'utf8',
    );
    const fixtureRoot = mkdtempSync(
      join(process.cwd(), 'packages/server/.tmp-app-contract-diagnostic-'),
    );
    const fileName = join(fixtureRoot, 'diagnostic-query.ts');
    writeFileSync(fileName, fixtureSource, 'utf8');
    try {
      const expectedStart = fixtureSource.indexOf('lod');
      const program = ts.createProgram({
        options: {
          allowImportingTsExtensions: true,
          exactOptionalPropertyTypes: true,
          lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          noEmit: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          strict: true,
          target: ts.ScriptTarget.ES2024,
          types: ['node'],
        },
        rootNames: [fileName],
      });
      const diagnostic = ts
        .getPreEmitDiagnostics(program)
        .find((entry) => entry.file?.fileName === fileName && entry.start === expectedStart);
      const message =
        diagnostic === undefined
          ? ''
          : ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

      expect(diagnostic?.code).toBe(2322);
      expect(diagnostic?.start).toBe(expectedStart);
      expect(diagnostic?.length).toBe(3);
      expect(message).toBe("Type '() => { ok: boolean; }' is not assignable to type 'never'.");
      expect(message.length).toBeLessThanOrEqual(240);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('emits provider-free production handles through canonical public declarations', () => {
    const output = emitDeclarationFixture('declaration-nameability.ts');

    expect(auditDeclarationOutput(output)).toEqual([]);
    expectPublicHandleTypes(output, {
      Notes: { specifier: '@kovojs/core', symbol: 'Component' },
      addNote: { specifier: '@kovojs/server', symbol: 'MutationHandle' },
      app: { specifier: '@kovojs/server', symbol: 'DefinedKovoContract' },
      healthEndpoint: { specifier: '@kovojs/server', symbol: 'EndpointHandle' },
      kovoApp: { specifier: '@kovojs/server/custom-adapters', symbol: 'KovoApp' },
      notes: { specifier: '@kovojs/server', symbol: 'QueryHandle' },
      notesRoute: { specifier: '@kovojs/server', symbol: 'RouteHandle' },
      refreshNotes: { specifier: '@kovojs/server', symbol: 'AppTaskHandle' },
    });
  });

  it('preserves provider-backed request and declaration payload inference during emit', () => {
    const output = emitDeclarationFixture('declaration-nameability-providers.ts');

    expect(auditDeclarationOutput(output)).toEqual([]);
    const exported = expectPublicHandleTypes(output, {
      ProviderNotes: { specifier: '@kovojs/core', symbol: 'Component' },
      providerAddNote: { specifier: '@kovojs/server', symbol: 'MutationHandle' },
      providerApp: { specifier: '@kovojs/server', symbol: 'DefinedKovoContract' },
      providerHealthEndpoint: { specifier: '@kovojs/server', symbol: 'EndpointHandle' },
      providerKovoApp: { specifier: '@kovojs/server/custom-adapters', symbol: 'KovoApp' },
      providerNotes: { specifier: '@kovojs/server', symbol: 'QueryHandle' },
      providerNotesRoute: { specifier: '@kovojs/server', symbol: 'RouteHandle' },
      providerRefreshNotes: { specifier: '@kovojs/server', symbol: 'AppTaskHandle' },
    });
    const source = ts.createSourceFile(
      'provider-nameability.d.ts',
      output,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const queryType = exported.get('providerNotes')!.getText(source);
    const mutationType = exported.get('providerAddNote')!.getText(source);
    const appType = exported.get('providerKovoApp')!.getText(source);

    expect(queryType).toContain('readonly ownerId: string');
    expect(queryType).toContain('items: ProviderNote[]');
    expect(mutationType).toContain('readonly ownerId: string');
    expect(mutationType).toContain('DUPLICATE_NOTE');
    expect(mutationType).toContain('userId: string');
    expect(appType).toContain('readonly request: Request &');
    expect(appType).toContain('db: ProviderDb');
    expect(appType).toContain('session: ProviderSession | null');
    expect(appType).toContain('readonly APP_NAME: string');
  });

  it('rejects declaration output that hides any or private/internal names', () => {
    const adversarial = readFileSync(
      join(declarationFixtureDirectory, 'declaration-nameability-adversarial.d.ts.fixture'),
      'utf8',
    );

    expect(auditDeclarationOutput(adversarial)).toEqual([
      'export leakedApp expands an anonymous top-level handle',
      'public declaration contains any',
      'public declaration expands private witness readerDbBrand',
      'public declaration imports non-public module ../../src/managed-db.js',
    ]);
  });
});
