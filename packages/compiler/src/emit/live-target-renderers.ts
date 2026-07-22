import {
  compilerArrayAppend,
  compilerCreateSet,
  compilerJsonStringify,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerSetSize,
  compilerSnapshotDenseArray,
  compilerStringSlice,
} from '../compiler-security-intrinsics.js';
import type { NamedImportModel } from '../scan/model.js';
import type { LiveTargetFact } from '../types.js';

const liveTargetWireModule = '@kovojs/server/internal/wire';
const liveTargetWireImports = [
  'componentLiveTargetRenderer',
  'registerGeneratedLiveTargetRenderer',
] as const;

export interface EmitLiveTargetRendererExportsOptions {
  componentExpression: string;
  componentExpressionForFact?: (fact: LiveTargetFact) => string;
  liveTargetFacts: readonly LiveTargetFact[];
  moduleImportInsertionOffset: number;
  namedImports: readonly NamedImportModel[];
  source: string;
  sourceIdentifierNames: readonly string[];
}

interface LiveTargetRendererBindings {
  readonly componentLiveTargetRenderer: string;
  readonly imports: readonly string[];
  readonly occupied: Set<string>;
  readonly registerGeneratedLiveTargetRenderer: string;
}

export function appendLiveTargetRendererExports(
  options: EmitLiveTargetRendererExportsOptions,
): string {
  const facts = compilerSnapshotDenseArray(options.liveTargetFacts, 'Live-target renderer facts');
  if (facts.length === 0) return options.source;

  const bindings = liveTargetRendererBindings(options.namedImports, options.sourceIdentifierNames);
  const sourceWithImport = insertLiveTargetRendererImport(
    options.source,
    options.moduleImportInsertionOffset,
    bindings.imports,
  );
  const exports: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    compilerArrayAppend(
      exports,
      liveTargetRendererExport(
        options.componentExpressionForFact?.(fact) ?? options.componentExpression,
        fact,
        bindings,
      ),
      'Compiler packages/compiler/src/emit/live-target-renderers.ts collection',
    );
  }

  return `${compilerRegExpReplace(/\s+$/g, sourceWithImport, '')}\n\n${joinRendererStrings(exports, '\n\n')}\n`;
}

function insertLiveTargetRendererImport(
  source: string,
  moduleImportInsertionOffset: number,
  imports: readonly string[],
): string {
  if (imports.length === 0) return source;
  const importLine = `import { ${joinRendererStrings(imports, ', ')} } from '${liveTargetWireModule}';\n`;

  const prefix = compilerStringSlice(source, 0, moduleImportInsertionOffset);
  const suffix = compilerStringSlice(source, moduleImportInsertionOffset);
  return `${prefix}${importLine}${suffix}`;
}

function liveTargetRendererBindings(
  namedImports: readonly NamedImportModel[],
  sourceIdentifierNames: readonly string[],
): LiveTargetRendererBindings {
  const imports = compilerSnapshotDenseArray(namedImports, 'Live-target named-import facts');
  const occupied = compilerCreateSet<string>();
  const identifiers = compilerSnapshotDenseArray(
    sourceIdentifierNames,
    'Live-target source identifier facts',
  );
  for (let index = 0; index < identifiers.length; index += 1) {
    compilerSetAdd(occupied, identifiers[index]!);
  }

  const missing: string[] = [];
  const selected: string[] = [];
  for (let helperIndex = 0; helperIndex < liveTargetWireImports.length; helperIndex += 1) {
    const importedName = liveTargetWireImports[helperIndex]!;
    let localName: string | undefined;
    for (let importIndex = 0; importIndex < imports.length; importIndex += 1) {
      const imported = imports[importIndex]!;
      if (
        imported.moduleSpecifier === liveTargetWireModule &&
        imported.importedName === importedName
      ) {
        localName = imported.localName;
        break;
      }
    }
    if (localName === undefined) {
      localName = collisionFreeLiveTargetBinding(importedName, occupied, identifiers.length + 2);
      compilerSetAdd(occupied, localName);
      compilerArrayAppend(
        missing,
        localName === importedName ? importedName : `${importedName} as ${localName}`,
        'Live-target missing helper imports',
      );
    }
    compilerArrayAppend(selected, localName, 'Live-target selected helper bindings');
  }

  return {
    componentLiveTargetRenderer: selected[0]!,
    imports: missing,
    occupied,
    registerGeneratedLiveTargetRenderer: selected[1]!,
  };
}

function collisionFreeLiveTargetBinding(
  base: string,
  occupied: ReadonlySet<string>,
  maximumSuffix: number,
): string {
  if (!compilerSetHas(occupied, base)) return base;
  for (let suffix = 1; suffix <= maximumSuffix; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!compilerSetHas(occupied, candidate)) return candidate;
  }
  throw new TypeError('Kovo could not select a collision-free live-target helper binding.');
}

function liveTargetRendererExport(
  componentExpression: string,
  fact: LiveTargetFact,
  bindings: LiveTargetRendererBindings,
): string {
  const exportName = collisionFreeLiveTargetBinding(
    liveTargetRendererExportName(componentExpression),
    bindings.occupied,
    compilerSetSize(bindings.occupied) + 1,
  );
  compilerSetAdd(bindings.occupied, exportName);
  const queries = liveTargetRendererQueries(fact);
  const optionLines = [
    `  component: ${componentExpression},`,
    `  componentId: ${rendererJsonSource(fact.component, 'Live-target component id')},`,
  ];
  if (queries)
    compilerArrayAppend(
      optionLines,
      queries,
      'Compiler packages/compiler/src/emit/live-target-renderers.ts collection',
    );

  return `export const ${exportName} = ${bindings.registerGeneratedLiveTargetRenderer}(${bindings.componentLiveTargetRenderer}({
${joinRendererStrings(optionLines, '\n')}
}));`;
}

function liveTargetRendererExportName(componentExpression: string): string {
  return `${compilerRegExpReplace(/[^A-Za-z0-9_$]/g, componentExpression, '_')}$liveTargetRenderer`;
}

function liveTargetRendererQueries(fact: LiveTargetFact): string {
  const facts = compilerSnapshotDenseArray(fact.queryBindings, 'Live-target query bindings');
  const bindings: string[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const binding = liveTargetRendererQueryBinding(facts[index]!);
    if (binding !== null)
      compilerArrayAppend(
        bindings,
        binding,
        'Compiler packages/compiler/src/emit/live-target-renderers.ts collection',
      );
  }
  if (bindings.length === 0) return '';

  return `  queries: [
${joinRendererStrings(bindings, ',\n')}
  ],`;
}

function liveTargetRendererQueryBinding(
  binding: LiveTargetFact['queryBindings'][number],
): string | null {
  if (!binding.executable) return null;

  const args =
    binding.argsExpression && binding.argsParam
      ? `, args: (${binding.argsParam}) => ${binding.argsExpression}`
      : '';
  return `    { name: ${rendererJsonSource(binding.name, 'Live-target query name')}, query: ${binding.queryExpression}${args} }`;
}

function joinRendererStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function rendererJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}
