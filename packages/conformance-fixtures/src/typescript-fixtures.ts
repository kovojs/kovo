import { fileURLToPath } from 'node:url';

export interface AssertTypeScriptProgramOptions {
  compilerOptions?: import('typescript').CompilerOptions;
  workspaceRoot?: string;
}

export type TypeScriptInterfaceMemberTypes = Record<string, string>;

export async function assertTypeScriptProgramHasNoDiagnostics(
  files: Record<string, string>,
  options: AssertTypeScriptProgramOptions = {},
): Promise<void> {
  const ts = await import('typescript');
  const workspaceRoot =
    options.workspaceRoot ?? fileURLToPath(new URL('../../../', import.meta.url));
  const compilerOptions: import('typescript').CompilerOptions = {
    allowImportingTsExtensions: true,
    baseUrl: workspaceRoot,
    exactOptionalPropertyTypes: true,
    ignoreDeprecations: '6.0',
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    paths: {
      '@kovojs/core': ['dist/core/src/index.d.mts'],
      '@kovojs/core/internal/fragment-target': ['dist/core/src/internal/fragment-target.d.mts'],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
    types: ['node'],
    ...options.compilerOptions,
  };
  const program = createVirtualProgram(ts, files, compilerOptions);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const formatted = diagnostics.map((diagnostic) => formatDiagnostic(ts, diagnostic));

  if (formatted.length > 0) {
    throw new Error(
      `Expected TypeScript virtual program to have no diagnostics:\n${formatted.join('\n')}`,
    );
  }
}

export async function typeScriptInterfaceMemberTypes(
  fileName: string,
  source: string,
  interfaceName: string,
): Promise<TypeScriptInterfaceMemberTypes> {
  const ts = await import('typescript');
  const compilerOptions: import('typescript').CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
  const program = createVirtualProgram(ts, { [fileName]: source }, compilerOptions);
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
    throw new Error(`TypeScript parsed ${fileName}`);
  }
  const interfaceNode = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  if (!interfaceNode) {
    throw new Error(`TypeScript registry exports interface ${interfaceName}`);
  }
  const checker = program.getTypeChecker();

  return Object.fromEntries(
    checker
      .getTypeAtLocation(interfaceNode)
      .getProperties()
      .map((symbol): [string, string] => [
        symbol.name,
        checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, interfaceNode)),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function createVirtualProgram(
  ts: typeof import('typescript'),
  files: Record<string, string>,
  compilerOptions: import('typescript').CompilerOptions,
): import('typescript').Program {
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const virtualFiles = new Map(Object.entries(files));
  const host: import('typescript').CompilerHost = {
    ...defaultHost,
    fileExists(fileName) {
      return virtualFiles.has(fileName) || defaultHost.fileExists(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const sourceText = virtualFiles.get(fileName);
      if (sourceText !== undefined) {
        return ts.createSourceFile(fileName, sourceText, languageVersion, true);
      }
      return defaultHost.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    readFile(fileName) {
      return virtualFiles.get(fileName) ?? defaultHost.readFile(fileName);
    },
  };

  return ts.createProgram([...virtualFiles.keys()], compilerOptions, host);
}

function formatDiagnostic(
  ts: typeof import('typescript'),
  diagnostic: import('typescript').Diagnostic,
): string {
  const file = diagnostic.file;
  const position =
    file && diagnostic.start !== undefined
      ? file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  const site =
    file && position
      ? `${file.fileName}:${position.line + 1}:${position.character + 1}`
      : file?.fileName;
  return [diagnostic.code, site, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')]
    .filter(Boolean)
    .join(' ');
}
