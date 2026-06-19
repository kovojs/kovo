import ts from 'typescript';

import type { LiveTargetFact } from '../types.js';

const liveTargetWireModule = '@kovojs/server/internal/wire';

export interface EmitLiveTargetRendererExportsOptions {
  componentExpression: string;
  liveTargetFacts: readonly LiveTargetFact[];
  source: string;
}

export function appendLiveTargetRendererExports(
  options: EmitLiveTargetRendererExportsOptions,
): string {
  if (options.liveTargetFacts.length === 0) return options.source;

  const sourceWithImport = insertLiveTargetRendererImport(options.source);
  const exports = options.liveTargetFacts
    .map((fact) => liveTargetRendererExport(options.componentExpression, fact))
    .join('\n\n');

  return `${sourceWithImport.trimEnd()}\n\n${exports}\n`;
}

function insertLiveTargetRendererImport(source: string): string {
  const sourceFile = ts.createSourceFile(
    'lowered.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hasWireImport = sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === liveTargetWireModule,
  );
  if (hasWireImport) return source;

  const importDeclarationEnd =
    sourceFile.statements.findLast((statement) => ts.isImportDeclaration(statement))?.end ?? 0;
  const importLine = `import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '${liveTargetWireModule}';\n`;

  if (importDeclarationEnd > 0) {
    const prefix = source.slice(0, importDeclarationEnd);
    const suffix = source.slice(importDeclarationEnd);
    return `${prefix}\n${importLine}${suffix}`;
  }

  return `${importLine}${source}`;
}

function liveTargetRendererExport(componentExpression: string, fact: LiveTargetFact): string {
  const exportName = liveTargetRendererExportName(componentExpression);

  return `export const ${exportName} = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ${componentExpression},
  componentId: ${JSON.stringify(fact.component)},
}));`;
}

function liveTargetRendererExportName(componentExpression: string): string {
  return `${componentExpression.replaceAll(/[^A-Za-z0-9_$]/g, '_')}$liveTargetRenderer`;
}
