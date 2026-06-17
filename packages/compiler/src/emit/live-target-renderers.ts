import ts from 'typescript';

import type { LiveTargetFact } from '../types.js';

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
  if (source.includes(`from '@kovojs/server/internal/wire'`)) return source;

  const sourceFile = ts.createSourceFile(
    'lowered.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const importDeclarationEnd =
    sourceFile.statements.findLast((statement) => ts.isImportDeclaration(statement))?.end ?? 0;
  const importLine = `import { componentLiveTargetRenderer } from '@kovojs/server/internal/wire';\n`;

  if (importDeclarationEnd > 0) {
    const prefix = source.slice(0, importDeclarationEnd);
    const suffix = source.slice(importDeclarationEnd);
    return `${prefix}\n${importLine}${suffix}`;
  }

  return `${importLine}${source}`;
}

function liveTargetRendererExport(componentExpression: string, fact: LiveTargetFact): string {
  const exportName = liveTargetRendererExportName(componentExpression);
  const queries =
    fact.queryBindings.length === 0
      ? '[]'
      : `[\n${fact.queryBindings.map((binding) => liveTargetQueryBindingSource(binding)).join(',\n')},\n  ]`;

  return `export const ${exportName} = componentLiveTargetRenderer({
  component: ${componentExpression},
  componentId: ${JSON.stringify(fact.component)},
  queries: ${queries},
});`;
}

function liveTargetRendererExportName(componentExpression: string): string {
  return `${componentExpression.replaceAll(/[^A-Za-z0-9_$]/g, '_')}$liveTargetRenderer`;
}

function liveTargetQueryBindingSource(binding: LiveTargetFact['queryBindings'][number]): string {
  const args =
    binding.argsExpression === undefined
      ? ''
      : `,\n      args: (${binding.argsParam ?? 'props'}) => ${binding.argsExpression}`;

  return `    {
      name: ${JSON.stringify(binding.name)},
      query: ${binding.queryExpression}${args},
    }`;
}
