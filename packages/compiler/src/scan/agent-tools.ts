import * as path from 'node:path';

import * as ts from 'typescript';

import type * as CoreGraph from '@kovojs/core/internal/graph';

import { parseSourceFile } from './parse.js';

/** @internal One authored module that may contain framework-owned `tool()` declarations. */
export interface AgentToolModuleSource {
  fileName: string;
  source: string;
}

/**
 * @internal Produce sound, reachable sink rows from framework-owned `tool()` handlers.
 *
 * This scanner intentionally accepts a narrow subset: a named `tool` import from `@kovojs/server`,
 * a literal `name`, direct handler-body reads/calls, direct calls to top-level same-module helper
 * functions that are visible in the parsed AST, directly-invoked inline function bodies, and local
 * helpers reached through parenthesized/type-only/static optional call targets, static
 * named/default imports including static local re-export barrels, unique local `export *` barrels
 * for named imports, static local default re-export barrels for already-proven default
 * helper/object/array summaries, default exports that alias a summarized local helper, static
 * namespace-property calls into exported local helpers, local `const` object aliases whose
 * properties statically point at summarized helpers, `Object.freeze(...)` wrappers around those
 * same static object aliases or already-proven object/nested-object aliases that are not assigned
 * or mutated, local `const` array/tuple aliases and default array/tuple exports whose literal
 * indexes statically point at summarized helpers, `Object.freeze(...)` wrappers around those same
 * static array/tuple aliases or already-proven array aliases that are not assigned or mutated,
 * default object exports whose properties statically point at summarized helpers or freeze an
 * already-proven object alias,
 * top-level `const` destructuring from
 * already-proven helper object/array aliases or namespaces, handler properties that reference a
 * summarized local/imported helper function, and inline callbacks passed to a local/imported helper
 * that directly invokes that callback parameter,
 * a simple `const` alias of that parameter, a static `const` object property alias of that
 * parameter, a static `const` array index alias of that parameter, a readonly array wrapper method
 * that directly invokes each proven callback element, a static object wrapper around a proven or
 * inline const-literal callback array, or one additional static const object wrapper around such an
 * object wrapper, and one static const object wrapper around already-proven helper object aliases or
 * namespace imports. The outbound-egress callee is recognized as a bare `fetch` (unless shadowed) or
 * the `globalThis.fetch`/`window.fetch`/`self.fetch` member forms; a secret read is recognized as
 * `process.env.NAME` or `process.env['NAME']` (string-literal key) — see SPEC.md §6.6.
 *
 * It does not inspect raw source text after parse. A callback handed to an unanalyzable callee (a
 * built-in array/promise method such as `forEach`/`map`/`then`, or any non-helper function) cannot
 * be proven invoked, so the sinks reachable through it are reported **audit-grade** (visible in
 * `kovo explain --capabilities`, not `kovo check`-enforced) per SPEC.md §6.6 rule 3 rather than
 * skipped — keeping the blast radius from being silently empty. Everything else stays outside the
 * sound subset until a dedicated analyzer proves it: computed namespace access,
 * computed/spread/duplicate object/array aliases and exports, export-star namespaces, ambiguous
 * export-star names, reassigned callback aliases, mutated callback property/index aliases, mutable
 * frozen-existing aliases, mutable/defaulted/nested destructuring, mutating/dynamic array methods,
 * shadowed `Object.freeze`, callbacks bundled inside object-literal arguments, and dynamic paths.
 */
export function agentToolSinksFromSource(
  moduleSource: AgentToolModuleSource,
  moduleSources: readonly AgentToolModuleSource[] = [moduleSource],
): CoreGraph.AgentToolReachableSinkFact[] {
  const modules = summarizeModules(moduleSources);
  const sourceFile = modules.sourceFiles.get(normalizeModuleFileName(moduleSource.fileName));
  if (!sourceFile) return [];

  const toolLocalNames = frameworkToolImportNames(sourceFile);
  if (toolLocalNames.size === 0) return [];

  const moduleFacts = modules.facts.get(sourceFile);
  if (!moduleFacts) return [];

  const facts: CoreGraph.AgentToolReachableSinkFact[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== sourceFile && ts.isFunctionLike(node)) return;

    if (!ts.isCallExpression(node) || !isIdentifierNamed(node.expression, toolLocalNames)) {
      ts.forEachChild(node, visit);
      return;
    }

    const [definition] = node.arguments;
    if (!definition || !ts.isObjectLiteralExpression(definition)) return;

    const name = stringPropertyValue(definition, 'name');
    if (name === undefined) return;

    const handler = handlerTarget(definition, moduleFacts);
    if (handler === undefined) return;

    facts.push(...handlerSinkFacts(name, handler));
  };

  visit(sourceFile);
  return uniqueAgentToolSinkFacts(facts).sort(compareAgentToolSinkFact);
}

interface ModuleFacts {
  ambiguousExportStarHelpers: ReadonlySet<string>;
  arrayAliasHelpers: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>;
  defaultArrayHelpers: ReadonlyMap<string, HelperDefinition>;
  defaultObjectHelpers: ReadonlyMap<string, HelperDefinition>;
  exportedArrayAliasHelpers: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>;
  exportedObjectAliasHelpers: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>;
  helpers: ReadonlyMap<string, HelperDefinition>;
  nestedObjectAliasHelpers: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>
  >;
  objectAliasHelpers: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>;
  namespaceImports: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>;
  sourceFile: ts.SourceFile;
  topLevelBindings: ReadonlySet<string>;
}

interface HelperDefinition {
  exported: boolean;
  id: string;
  moduleFacts: ModuleFacts;
  node: ts.FunctionLikeDeclaration;
  reachedThroughExportStar?: true;
}

interface HandlerTarget {
  moduleFacts: ModuleFacts;
  node: ts.FunctionLikeDeclaration;
  origin: AgentToolSinkOrigin;
}

interface ModuleSummaries {
  facts: ReadonlyMap<ts.SourceFile, ModuleFacts>;
  sourceFiles: ReadonlyMap<string, ts.SourceFile>;
}

function summarizeModules(moduleSources: readonly AgentToolModuleSource[]): ModuleSummaries {
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const moduleSource of moduleSources) {
    const fileName = normalizeModuleFileName(moduleSource.fileName);
    if (!sourceFiles.has(fileName)) {
      sourceFiles.set(fileName, parseSourceFile(moduleSource.fileName, moduleSource.source));
    }
  }

  const facts = new Map<ts.SourceFile, ModuleFacts>();
  for (const sourceFile of sourceFiles.values()) {
    facts.set(sourceFile, summarizeModule(sourceFile));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const moduleFacts of facts.values()) {
      changed = linkImportedHelpers(moduleFacts, sourceFiles, facts) || changed;
    }
  }

  return { facts, sourceFiles };
}

function summarizeModule(sourceFile: ts.SourceFile): ModuleFacts {
  const ambiguousExportStarHelpers = new Set<string>();
  const arrayAliasHelpers = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  const defaultArrayHelpers = new Map<string, HelperDefinition>();
  const defaultObjectHelpers = new Map<string, HelperDefinition>();
  const exportedArrayAliasHelpers = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  const exportedObjectAliasHelpers = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  const helpers = new Map<string, HelperDefinition>();
  const nestedObjectAliasHelpers = new Map<
    string,
    ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>
  >();
  const objectAliasHelpers = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  const namespaceImports = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  const topLevelBindings = new Set<string>();
  const moduleFacts: ModuleFacts = {
    ambiguousExportStarHelpers,
    arrayAliasHelpers,
    defaultArrayHelpers,
    defaultObjectHelpers,
    exportedArrayAliasHelpers,
    exportedObjectAliasHelpers,
    helpers,
    nestedObjectAliasHelpers,
    objectAliasHelpers,
    namespaceImports,
    sourceFile,
    topLevelBindings,
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportBindingNames(statement, topLevelBindings);
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelBindings.add(statement.name.text);
      helpers.set(statement.name.text, {
        exported: hasExportModifier(statement) && !hasDefaultModifier(statement),
        id: helperId(sourceFile, statement.name.text),
        moduleFacts,
        node: statement,
      });
    }

    const defaultExportedFunction = defaultExportedFunctionHelper(statement);
    if (defaultExportedFunction) {
      helpers.set('default', {
        exported: true,
        id: helperId(sourceFile, 'default'),
        moduleFacts,
        node: defaultExportedFunction,
      });
      continue;
    }

    if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      topLevelBindings.add(statement.name.text);
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, topLevelBindings);
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        helpers.set(declaration.name.text, {
          exported: hasExportModifier(statement),
          id: helperId(sourceFile, declaration.name.text),
          moduleFacts,
          node: declaration.initializer,
        });
      }
    }
  }

  for (const statement of sourceFile.statements) {
    collectArrayAliasHelperBindings(statement, moduleFacts);
    collectObjectAliasHelperBindings(statement, moduleFacts);
    collectDefaultHelperAlias(statement, moduleFacts);
    collectDefaultArrayHelperBindings(statement, moduleFacts);
    collectDefaultObjectHelperBindings(statement, moduleFacts);
  }

  return moduleFacts;
}

function linkImportedHelpers(
  moduleFacts: ModuleFacts,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  facts: ReadonlyMap<ts.SourceFile, ModuleFacts>,
): boolean {
  const helpers = moduleFacts.helpers as Map<string, HelperDefinition>;
  const arrayAliasHelpers = moduleFacts.arrayAliasHelpers as Map<
    string,
    ReadonlyMap<string, HelperDefinition>
  >;
  const defaultArrayHelpers = moduleFacts.defaultArrayHelpers as Map<string, HelperDefinition>;
  const defaultObjectHelpers = moduleFacts.defaultObjectHelpers as Map<string, HelperDefinition>;
  const exportedArrayAliasHelpers = moduleFacts.exportedArrayAliasHelpers as Map<
    string,
    ReadonlyMap<string, HelperDefinition>
  >;
  const exportedObjectAliasHelpers = moduleFacts.exportedObjectAliasHelpers as Map<
    string,
    ReadonlyMap<string, HelperDefinition>
  >;
  const objectAliasHelpers = moduleFacts.objectAliasHelpers as Map<
    string,
    ReadonlyMap<string, HelperDefinition>
  >;
  const namespaceImports = moduleFacts.namespaceImports as Map<
    string,
    ReadonlyMap<string, HelperDefinition>
  >;
  let changed = false;

  for (const statement of moduleFacts.sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier))
        continue;
      if (statement.importClause?.isTypeOnly) continue;

      const importedSourceFile = importedLocalSourceFile(
        moduleFacts.sourceFile,
        statement.moduleSpecifier.text,
        sourceFiles,
      );
      if (!importedSourceFile) continue;

      const importedFacts = facts.get(importedSourceFile);
      if (!importedFacts) continue;

      const defaultBinding = statement.importClause?.name;
      if (
        defaultBinding &&
        (linkHelperBinding(helpers, defaultBinding.text, importedFacts.helpers.get('default')) ||
          linkNamespaceBinding(
            arrayAliasHelpers,
            defaultBinding.text,
            importedFacts.defaultArrayHelpers,
          ) ||
          linkNamespaceBinding(
            objectAliasHelpers,
            defaultBinding.text,
            importedFacts.defaultObjectHelpers,
          ))
      ) {
        changed = true;
      }

      const bindings = statement.importClause?.namedBindings;
      if (!bindings) continue;

      if (ts.isNamespaceImport(bindings)) {
        const exportedHelpers = exportedHelperBindings(importedFacts.helpers);
        if (!helperBindingMapsEqual(namespaceImports.get(bindings.name.text), exportedHelpers)) {
          namespaceImports.set(bindings.name.text, exportedHelpers);
          changed = true;
        }
        continue;
      }

      if (!ts.isNamedImports(bindings)) continue;

      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;

        const importedName = element.propertyName?.text ?? element.name.text;
        const localName = element.name.text;
        if (
          linkHelperBinding(helpers, localName, importedFacts.helpers.get(importedName)) ||
          linkOptionalNamespaceBinding(
            arrayAliasHelpers,
            localName,
            importedFacts.exportedArrayAliasHelpers.get(importedName),
          ) ||
          linkOptionalNamespaceBinding(
            objectAliasHelpers,
            localName,
            importedFacts.exportedObjectAliasHelpers.get(importedName),
          )
        ) {
          changed = true;
        }
      }

      continue;
    }

    if (!ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.isTypeOnly) continue;

    const importedSourceFile = importedLocalSourceFile(
      moduleFacts.sourceFile,
      statement.moduleSpecifier.text,
      sourceFiles,
    );
    if (!importedSourceFile) continue;

    const importedFacts = facts.get(importedSourceFile);
    if (!importedFacts) continue;

    const exportClause = statement.exportClause;
    if (!exportClause) {
      for (const [exportedName, helper] of exportedHelperBindings(importedFacts.helpers, {
        includeExportStar: true,
      })) {
        if (linkExportStarHelperBinding(moduleFacts, exportedName, helper)) {
          changed = true;
        }
      }
      continue;
    }

    if (!ts.isNamedExports(exportClause)) continue;

    for (const element of exportClause.elements) {
      if (element.isTypeOnly) continue;

      const importedName = element.propertyName?.text ?? element.name.text;
      const exportedName = element.name.text;
      if (
        linkHelperBinding(helpers, exportedName, importedFacts.helpers.get(importedName)) ||
        (importedName === 'default' &&
          (exportedName === 'default'
            ? linkDefaultNamespaceBinding(defaultArrayHelpers, importedFacts.defaultArrayHelpers) ||
              linkDefaultNamespaceBinding(defaultObjectHelpers, importedFacts.defaultObjectHelpers)
            : linkExportedNamespaceBinding(
                arrayAliasHelpers,
                exportedArrayAliasHelpers,
                exportedName,
                importedFacts.defaultArrayHelpers,
              ) ||
              linkExportedNamespaceBinding(
                objectAliasHelpers,
                exportedObjectAliasHelpers,
                exportedName,
                importedFacts.defaultObjectHelpers,
              )))
      ) {
        changed = true;
      }
    }
  }

  for (const statement of moduleFacts.sourceFile.statements) {
    changed = collectArrayAliasHelperBindings(statement, moduleFacts) || changed;
    changed = collectObjectAliasHelperBindings(statement, moduleFacts) || changed;
    changed = collectNestedObjectAliasHelperBindings(statement, moduleFacts) || changed;
    changed = collectDefaultArrayHelperBindings(statement, moduleFacts) || changed;
    changed = collectDefaultObjectHelperBindings(statement, moduleFacts) || changed;
    changed = collectDestructuredHelperBindings(statement, moduleFacts) || changed;
  }

  return changed;
}

function exportedHelperBindings(
  helpers: ReadonlyMap<string, HelperDefinition>,
  options: { includeExportStar: boolean } = { includeExportStar: false },
): ReadonlyMap<string, HelperDefinition> {
  const exportedHelpers = new Map<string, HelperDefinition>();
  for (const [name, helper] of helpers) {
    if (helper.exported && (options.includeExportStar || !helper.reachedThroughExportStar)) {
      exportedHelpers.set(name, helper);
    }
  }

  return exportedHelpers;
}

function linkExportStarHelperBinding(
  moduleFacts: ModuleFacts,
  localName: string,
  helper: HelperDefinition,
): boolean {
  if (!helper.exported) return false;
  if (moduleFacts.ambiguousExportStarHelpers.has(localName)) return false;

  const helpers = moduleFacts.helpers as Map<string, HelperDefinition>;
  const existing = helpers.get(localName);
  if (existing) {
    if (!existing.reachedThroughExportStar) return false;

    if (existing.id !== helper.id) {
      helpers.delete(localName);
      (moduleFacts.ambiguousExportStarHelpers as Set<string>).add(localName);
      return true;
    }

    return false;
  }

  helpers.set(localName, { ...helper, exported: true, reachedThroughExportStar: true });
  return true;
}

function helperBindingMapsEqual(
  left: ReadonlyMap<string, HelperDefinition> | undefined,
  right: ReadonlyMap<string, HelperDefinition>,
): boolean {
  if (!left || left.size !== right.size) return false;

  for (const [name, helper] of right) {
    if (left.get(name)?.id !== helper.id) return false;
  }

  return true;
}

function linkHelperBinding(
  helpers: Map<string, HelperDefinition>,
  localName: string,
  helper: HelperDefinition | undefined,
): boolean {
  if (!helper?.exported) return false;
  if (helpers.has(localName)) return false;

  helpers.set(localName, helper);
  return true;
}

function linkNamespaceBinding(
  namespaceImports: Map<string, ReadonlyMap<string, HelperDefinition>>,
  localName: string,
  helpers: ReadonlyMap<string, HelperDefinition>,
): boolean {
  if (helpers.size === 0) return false;
  if (namespaceImports.has(localName)) return false;

  namespaceImports.set(localName, helpers);
  return true;
}

function linkOptionalNamespaceBinding(
  namespaceImports: Map<string, ReadonlyMap<string, HelperDefinition>>,
  localName: string,
  helpers: ReadonlyMap<string, HelperDefinition> | undefined,
): boolean {
  return helpers ? linkNamespaceBinding(namespaceImports, localName, helpers) : false;
}

function linkExportedNamespaceBinding(
  namespaceImports: Map<string, ReadonlyMap<string, HelperDefinition>>,
  exportedNamespaceImports: Map<string, ReadonlyMap<string, HelperDefinition>>,
  localName: string,
  helpers: ReadonlyMap<string, HelperDefinition>,
): boolean {
  if (!linkNamespaceBinding(namespaceImports, localName, helpers)) return false;

  exportedNamespaceImports.set(localName, helpers);
  return true;
}

function linkDefaultNamespaceBinding(
  namespaceHelpers: Map<string, HelperDefinition>,
  helpers: ReadonlyMap<string, HelperDefinition>,
): boolean {
  if (helpers.size === 0) return false;
  if (helperBindingMapsEqual(namespaceHelpers, helpers)) return false;

  namespaceHelpers.clear();
  for (const [name, helper] of helpers) {
    namespaceHelpers.set(name, helper);
  }
  return true;
}

function collectArrayAliasHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;

  let changed = false;

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

    const helperBindings = arrayHelperBindingsFromInitializer(declaration.initializer, moduleFacts);
    if (!helperBindings) continue;

    const arrayAliasHelpers = moduleFacts.arrayAliasHelpers as Map<
      string,
      ReadonlyMap<string, HelperDefinition>
    >;
    if (helperBindingMapsEqual(arrayAliasHelpers.get(declaration.name.text), helperBindings)) {
      continue;
    }

    arrayAliasHelpers.set(declaration.name.text, helperBindings);
    changed = true;
  }

  return changed;
}

function collectObjectAliasHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;

  let changed = false;

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

    const helperBindings = objectHelperBindingsFromInitializer(
      declaration.initializer,
      moduleFacts,
    );
    if (!helperBindings) continue;

    const objectAliasHelpers = moduleFacts.objectAliasHelpers as Map<
      string,
      ReadonlyMap<string, HelperDefinition>
    >;
    if (helperBindingMapsEqual(objectAliasHelpers.get(declaration.name.text), helperBindings)) {
      continue;
    }

    objectAliasHelpers.set(declaration.name.text, helperBindings);
    changed = true;
  }

  return changed;
}

function collectNestedObjectAliasHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;

  let changed = false;

  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
    if (isAssignedBinding(moduleFacts.sourceFile, declaration.name.text)) continue;

    const helperBindings = nestedObjectHelperBindingsFromInitializer(
      declaration.initializer,
      moduleFacts,
    );
    if (!helperBindings) continue;

    const nestedObjectAliasHelpers = moduleFacts.nestedObjectAliasHelpers as Map<
      string,
      ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>
    >;
    if (
      nestedHelperBindingMapsEqual(
        nestedObjectAliasHelpers.get(declaration.name.text),
        helperBindings,
      )
    ) {
      continue;
    }

    nestedObjectAliasHelpers.set(declaration.name.text, helperBindings);
    changed = true;
  }

  return changed;
}

function collectDestructuredHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;

  let changed = false;

  for (const declaration of statement.declarationList.declarations) {
    if (!declaration.initializer) continue;

    const initializer = unwrapParentheses(declaration.initializer);
    if (!ts.isIdentifier(initializer)) continue;

    if (ts.isObjectBindingPattern(declaration.name)) {
      const sourceHelpers =
        moduleFacts.objectAliasHelpers.get(initializer.text) ??
        moduleFacts.namespaceImports.get(initializer.text);
      if (!sourceHelpers) continue;

      changed =
        linkDestructuredObjectHelperBindings(declaration.name, sourceHelpers, moduleFacts) ||
        changed;
      continue;
    }

    if (ts.isArrayBindingPattern(declaration.name)) {
      const sourceHelpers = moduleFacts.arrayAliasHelpers.get(initializer.text);
      if (!sourceHelpers) continue;

      changed =
        linkDestructuredArrayHelperBindings(declaration.name, sourceHelpers, moduleFacts) ||
        changed;
    }
  }

  return changed;
}

function linkDestructuredObjectHelperBindings(
  pattern: ts.ObjectBindingPattern,
  sourceHelpers: ReadonlyMap<string, HelperDefinition>,
  moduleFacts: ModuleFacts,
): boolean {
  const bindings = new Map<string, HelperDefinition>();

  for (const element of pattern.elements) {
    if (element.dotDotDotToken || element.initializer) return false;
    if (!ts.isIdentifier(element.name)) return false;
    if (element.propertyName && ts.isComputedPropertyName(element.propertyName)) return false;

    const sourceName =
      element.propertyName === undefined
        ? element.name.text
        : staticPropertyName(element.propertyName);
    if (sourceName === undefined) return false;

    const helper = sourceHelpers.get(sourceName);
    if (!helper) return false;
    bindings.set(element.name.text, helper);
  }

  return linkDestructuredHelperBindings(
    moduleFacts.helpers as Map<string, HelperDefinition>,
    bindings,
  );
}

function linkDestructuredArrayHelperBindings(
  pattern: ts.ArrayBindingPattern,
  sourceHelpers: ReadonlyMap<string, HelperDefinition>,
  moduleFacts: ModuleFacts,
): boolean {
  const bindings = new Map<string, HelperDefinition>();

  for (let index = 0; index < pattern.elements.length; index += 1) {
    const element = pattern.elements[index];
    if (!element) return false;
    if (ts.isOmittedExpression(element)) continue;
    if (!ts.isBindingElement(element)) return false;
    if (element.dotDotDotToken || element.initializer) return false;
    if (!ts.isIdentifier(element.name)) return false;

    const helper = sourceHelpers.get(String(index));
    if (!helper) return false;
    bindings.set(element.name.text, helper);
  }

  return linkDestructuredHelperBindings(
    moduleFacts.helpers as Map<string, HelperDefinition>,
    bindings,
  );
}

function linkDestructuredHelperBindings(
  helpers: Map<string, HelperDefinition>,
  bindings: ReadonlyMap<string, HelperDefinition>,
): boolean {
  let changed = false;
  for (const [localName, helper] of bindings) {
    changed = linkHelperBinding(helpers, localName, helper) || changed;
  }
  return changed;
}

function collectDefaultObjectHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): boolean {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return false;

  const helperBindings = objectHelperBindingsFromInitializer(statement.expression, moduleFacts);
  if (!helperBindings) return false;

  const defaultObjectHelpers = moduleFacts.defaultObjectHelpers as Map<string, HelperDefinition>;
  if (helperBindingMapsEqual(defaultObjectHelpers, helperBindings)) return false;

  defaultObjectHelpers.clear();
  for (const [propertyName, helper] of helperBindings) {
    defaultObjectHelpers.set(propertyName, helper);
  }
  return true;
}

function collectDefaultArrayHelperBindings(
  statement: ts.Statement,
  moduleFacts: ModuleFacts,
): boolean {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return false;

  const helperBindings = defaultArrayHelperBindingsFromExpression(
    statement.expression,
    moduleFacts,
  );
  if (!helperBindings) return false;

  const defaultArrayHelpers = moduleFacts.defaultArrayHelpers as Map<string, HelperDefinition>;
  if (helperBindingMapsEqual(defaultArrayHelpers, helperBindings)) return false;

  defaultArrayHelpers.clear();
  for (const [index, helper] of helperBindings) {
    defaultArrayHelpers.set(index, helper);
  }
  return true;
}

function defaultArrayHelperBindingsFromExpression(
  expression: ts.Expression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, HelperDefinition> | undefined {
  const helperBindings = arrayHelperBindingsFromInitializer(expression, moduleFacts);
  if (helperBindings) return helperBindings;

  const alias = unwrapParentheses(expression);
  if (!ts.isIdentifier(alias)) return undefined;
  if (isAssignedBinding(moduleFacts.sourceFile, alias.text)) return undefined;

  return moduleFacts.arrayAliasHelpers.get(alias.text);
}

function arrayHelperBindingsFromInitializer(
  initializer: ts.Expression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, HelperDefinition> | undefined {
  const expression = staticHelperAliasInitializer(initializer, moduleFacts);
  if (ts.isArrayLiteralExpression(expression)) {
    return helperBindingsFromArrayLiteral(expression, moduleFacts);
  }

  const aliasName = staticFrozenExistingAliasName(initializer, moduleFacts);
  return aliasName === undefined ? undefined : moduleFacts.arrayAliasHelpers.get(aliasName);
}

function objectHelperBindingsFromInitializer(
  initializer: ts.Expression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, HelperDefinition> | undefined {
  const expression = staticHelperAliasInitializer(initializer, moduleFacts);
  if (ts.isObjectLiteralExpression(expression)) {
    return helperBindingsFromObjectLiteral(expression, moduleFacts);
  }

  const aliasName = staticFrozenExistingAliasName(initializer, moduleFacts);
  return aliasName === undefined ? undefined : moduleFacts.objectAliasHelpers.get(aliasName);
}

function nestedObjectHelperBindingsFromInitializer(
  initializer: ts.Expression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>> | undefined {
  const expression = staticHelperAliasInitializer(initializer, moduleFacts);
  if (ts.isObjectLiteralExpression(expression)) {
    return nestedHelperBindingsFromObjectLiteral(expression, moduleFacts);
  }

  const aliasName = staticFrozenExistingAliasName(initializer, moduleFacts);
  return aliasName === undefined ? undefined : moduleFacts.nestedObjectAliasHelpers.get(aliasName);
}

function helperBindingsFromArrayLiteral(
  expression: ts.ArrayLiteralExpression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, HelperDefinition> | undefined {
  const helperBindings = new Map<string, HelperDefinition>();
  for (let index = 0; index < expression.elements.length; index += 1) {
    const element = expression.elements[index];
    if (!element || ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
      return undefined;
    }

    const initializer = unwrapParentheses(element);
    if (!ts.isIdentifier(initializer)) return undefined;

    const helper = moduleFacts.helpers.get(initializer.text);
    if (!helper) return undefined;

    helperBindings.set(String(index), exportedHelperAlias(helper));
  }

  return helperBindings;
}

function helperBindingsFromObjectLiteral(
  expression: ts.ObjectLiteralExpression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, HelperDefinition> | undefined {
  const helperBindings = new Map<string, HelperDefinition>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) return undefined;
    if (ts.isShorthandPropertyAssignment(property)) {
      const helper = moduleFacts.helpers.get(property.name.text);
      if (!helper) return undefined;
      helperBindings.set(property.name.text, exportedHelperAlias(helper));
      continue;
    }

    if (!ts.isPropertyAssignment(property)) return undefined;
    if (property.name === undefined || ts.isComputedPropertyName(property.name)) return undefined;

    const propertyName = staticPropertyName(property.name);
    if (propertyName === undefined || helperBindings.has(propertyName)) return undefined;

    const initializer = unwrapParentheses(property.initializer);
    if (!ts.isIdentifier(initializer)) return undefined;

    const helper = moduleFacts.helpers.get(initializer.text);
    if (!helper) return undefined;

    helperBindings.set(propertyName, exportedHelperAlias(helper));
  }

  return helperBindings;
}

function nestedHelperBindingsFromObjectLiteral(
  expression: ts.ObjectLiteralExpression,
  moduleFacts: ModuleFacts,
): ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>> | undefined {
  const helperBindings = new Map<string, ReadonlyMap<string, HelperDefinition>>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) return undefined;

    let propertyName: string | undefined;
    let initializer: ts.Expression;
    if (ts.isShorthandPropertyAssignment(property)) {
      propertyName = property.name.text;
      initializer = property.name;
    } else if (ts.isPropertyAssignment(property)) {
      if (property.name === undefined || ts.isComputedPropertyName(property.name)) return undefined;
      propertyName = staticPropertyName(property.name);
      initializer = property.initializer;
    } else {
      return undefined;
    }

    if (propertyName === undefined || helperBindings.has(propertyName)) return undefined;

    const alias = unwrapParentheses(initializer);
    if (!ts.isIdentifier(alias)) return undefined;
    if (isAssignedBinding(moduleFacts.sourceFile, alias.text)) return undefined;

    const nestedBindings =
      moduleFacts.objectAliasHelpers.get(alias.text) ??
      moduleFacts.namespaceImports.get(alias.text);
    if (!nestedBindings) return undefined;

    helperBindings.set(propertyName, nestedBindings);
  }

  return helperBindings.size === 0 ? undefined : helperBindings;
}

function nestedHelperBindingMapsEqual(
  left: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>> | undefined,
  right: ReadonlyMap<string, ReadonlyMap<string, HelperDefinition>>,
): boolean {
  if (!left || left.size !== right.size) return false;

  for (const [name, helpers] of right) {
    if (!helperBindingMapsEqual(left.get(name), helpers)) return false;
  }

  return true;
}

function collectDefaultHelperAlias(statement: ts.Statement, moduleFacts: ModuleFacts): void {
  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return;

  const expression = unwrapParentheses(statement.expression);
  if (!ts.isIdentifier(expression)) return;

  const helper = moduleFacts.helpers.get(expression.text);
  if (!helper) return;

  (moduleFacts.helpers as Map<string, HelperDefinition>).set(
    'default',
    exportedHelperAlias(helper),
  );
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function exportedHelperAlias(helper: HelperDefinition): HelperDefinition {
  return helper.exported ? helper : { ...helper, exported: true };
}

function importedLocalSourceFile(
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
): ts.SourceFile | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;

  const fromDirectory = path.posix.dirname(normalizeModuleFileName(sourceFile.fileName));
  const resolved = path.posix.normalize(path.posix.join(fromDirectory, moduleSpecifier));
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    path.posix.join(resolved, 'index.ts'),
    path.posix.join(resolved, 'index.tsx'),
    path.posix.join(resolved, 'index.js'),
    path.posix.join(resolved, 'index.jsx'),
  ];

  for (const candidate of candidates) {
    const sourceFile = sourceFiles.get(candidate);
    if (sourceFile) return sourceFile;
  }

  return undefined;
}

function normalizeModuleFileName(fileName: string): string {
  return path.posix.normalize(fileName.replaceAll('\\', '/'));
}

function helperId(sourceFile: ts.SourceFile, name: string): string {
  return `${normalizeModuleFileName(sourceFile.fileName)}\0${name}`;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
        false)
    : false;
}

function defaultExportedFunctionHelper(
  statement: ts.Statement,
): ts.FunctionLikeDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(statement) &&
    hasExportModifier(statement) &&
    hasDefaultModifier(statement)
  ) {
    return statement;
  }

  if (!ts.isExportAssignment(statement) || statement.isExportEquals) return undefined;

  const expression = unwrapParentheses(statement.expression);
  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    return expression;
  }

  return undefined;
}

function collectImportBindingNames(statement: ts.ImportDeclaration, names: Set<string>): void {
  const clause = statement.importClause;
  if (!clause) return;
  if (clause.name) names.add(clause.name.text);

  const bindings = clause.namedBindings;
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    names.add(bindings.name.text);
    return;
  }

  for (const element of bindings.elements) {
    names.add(element.name.text);
  }
}

function frameworkToolImportNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/server') continue;

    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      if ((element.propertyName?.text ?? element.name.text) === 'tool') {
        names.add(element.name.text);
      }
    }
  }

  return names;
}

function handlerSinkFacts(
  tool: string,
  handler: HandlerTarget,
): CoreGraph.AgentToolReachableSinkFact[] {
  if (!handler.node.body) return [];
  return reachableSinkFacts(
    handler.moduleFacts.sourceFile,
    tool,
    handler.node,
    handler.moduleFacts,
    new Set(),
    handler.origin,
  );
}

function reachableSinkFacts(
  sourceFile: ts.SourceFile,
  tool: string,
  fn: ts.FunctionLikeDeclaration,
  moduleFacts: ModuleFacts,
  activeHelpers: ReadonlySet<string>,
  origin: AgentToolSinkOrigin,
): CoreGraph.AgentToolReachableSinkFact[] {
  const body = fn.body;
  if (!body) return [];

  const facts: CoreGraph.AgentToolReachableSinkFact[] = [];
  const blockedNames = namesBlockedInFunctionBody(fn, moduleFacts.topLevelBindings);

  // SPEC §6.6 rule 3: once a sink path runs through an unproven nested callback, every deeper sink
  // it reaches is likewise only conditionally reachable, so the audit grade is sticky — a proven
  // (inline/helper) sub-path inside an unproven callback must not be promoted back to sound.
  const descendOrigin = (specific: AgentToolSinkOrigin): AgentToolSinkOrigin =>
    origin === 'nested-callback' ? 'nested-callback' : specific;

  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;

    const egress = egressSinkFact(sourceFile, tool, node, blockedNames, origin);
    if (egress) facts.push(egress);

    const secret = secretReadSinkFact(sourceFile, tool, node, blockedNames, origin);
    if (secret) facts.push(secret);

    const inlineCall = directlyInvokedInlineFunction(node);
    if (inlineCall !== undefined) {
      facts.push(
        ...reachableSinkFacts(
          sourceFile,
          tool,
          inlineCall,
          moduleFacts,
          activeHelpers,
          descendOrigin('inline'),
        ),
      );
    }

    const helper = calledHelper(node, moduleFacts, blockedNames);
    if (helper !== undefined && !activeHelpers.has(helper.id)) {
      const helperOrigin = descendOrigin(
        origin === 'imported-helper'
          ? 'imported-helper'
          : helper.moduleFacts.sourceFile === moduleFacts.sourceFile
            ? 'helper'
            : 'imported-helper',
      );
      facts.push(
        ...reachableSinkFacts(
          helper.moduleFacts.sourceFile,
          tool,
          helper.node,
          helper.moduleFacts,
          new Set([...activeHelpers, helper.id]),
          helperOrigin,
        ),
      );

      for (const callback of directlyInvokedCallbackArguments(node, helper)) {
        facts.push(
          ...reachableSinkFacts(
            sourceFile,
            tool,
            callback,
            moduleFacts,
            new Set([...activeHelpers, helper.id]),
            helperOrigin,
          ),
        );
      }
    }

    // SPEC §6.6 (capability disclosure completeness): a callback handed to an unanalyzable callee
    // — a built-in array/promise method such as `forEach`/`map`/`then`, or any non-helper function
    // — escapes proven-invocation analysis, so the prior `tool()` analyzer skipped its body whole
    // and under-reported the blast radius (`kovo explain --capabilities` was silently empty). We
    // descend for sink visibility but mark sinks audit-grade: invocation is not proven, so this is
    // defense-in-depth (visible in explain, not `kovo check`-enforced), not a by-construction bound.
    if (helper === undefined && inlineCall === undefined && ts.isCallExpression(node)) {
      for (const callback of unprovenCallbackArguments(node)) {
        facts.push(
          ...reachableSinkFacts(
            sourceFile,
            tool,
            callback,
            moduleFacts,
            activeHelpers,
            'nested-callback',
          ),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
  return facts;
}

type AgentToolSinkOrigin = 'handler' | 'helper' | 'imported-helper' | 'inline' | 'nested-callback';

type CallbackArrayElements = ReadonlyMap<string, string>;
type CallbackArrayObjectWrapperProperties = ReadonlyMap<string, CallbackArrayElements>;
type NestedCallbackArrayObjectWrapperProperties = ReadonlyMap<
  string,
  CallbackArrayObjectWrapperProperties
>;

function directlyInvokedInlineFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (!ts.isCallExpression(node)) return undefined;

  const expression = staticCallTargetExpression(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }

  return undefined;
}

/**
 * SPEC §6.6: the direct arrow/function arguments of a call whose callee Kovo cannot analyze (a
 * built-in array/promise method such as `forEach`/`map`/`then`, or any non-helper function). Their
 * invocation is not proven, so sinks inside them are reported audit-grade for blast-radius
 * completeness rather than enforced. Only direct callback arguments are walked; deeper wrapping
 * (object-literal-bundled callbacks) stays out of the analyzable subset.
 */
function unprovenCallbackArguments(node: ts.CallExpression): ts.FunctionLikeDeclaration[] {
  const callbacks: ts.FunctionLikeDeclaration[] = [];
  for (const argument of node.arguments) {
    const expression = unwrapParentheses(argument);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      callbacks.push(expression);
    }
  }
  return callbacks;
}

function directlyInvokedCallbackArguments(
  node: ts.Node,
  helper: HelperDefinition,
): ts.FunctionLikeDeclaration[] {
  if (!ts.isCallExpression(node)) return [];

  const invokedParameters = directlyInvokedCallbackParameters(helper.node);
  if (invokedParameters.size === 0) return [];

  const callbacks: ts.FunctionLikeDeclaration[] = [];
  helper.node.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return;
    if (!invokedParameters.has(parameter.name.text)) return;

    const argument = node.arguments[index];
    if (!argument) return;

    const expression = unwrapParentheses(argument);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      callbacks.push(expression);
    }
  });

  return callbacks;
}

function directlyInvokedCallbackParameters(fn: ts.FunctionLikeDeclaration): ReadonlySet<string> {
  const body = fn.body;
  if (!body) return new Set();

  const candidateNames = new Set<string>();
  for (const parameter of fn.parameters) {
    if (ts.isIdentifier(parameter.name)) candidateNames.add(parameter.name.text);
  }
  if (candidateNames.size === 0) return new Set();

  const aliasNames = simpleCallbackParameterAliases(body, candidateNames);
  const objectAliasProperties = simpleCallbackParameterObjectAliases(body, candidateNames);
  const arrayAliasElements = simpleCallbackParameterArrayAliases(body, candidateNames);
  const arrayObjectWrapperProperties = simpleCallbackParameterArrayObjectWrappers(
    body,
    arrayAliasElements,
    candidateNames,
  );
  const nestedArrayObjectWrapperProperties = simpleCallbackParameterNestedArrayObjectWrappers(
    body,
    arrayObjectWrapperProperties,
    candidateNames,
  );
  const callableParameterNames = new Map<string, string>();
  for (const candidateName of candidateNames) {
    callableParameterNames.set(candidateName, candidateName);
  }
  for (const [aliasName, parameterName] of aliasNames) {
    callableParameterNames.set(aliasName, parameterName);
  }
  const callableNames = new Set([
    ...callableParameterNames.keys(),
    ...objectAliasProperties.keys(),
    ...arrayAliasElements.keys(),
    ...arrayObjectWrapperProperties.keys(),
    ...nestedArrayObjectWrapperProperties.keys(),
  ]);

  const invokedNames = new Set<string>();
  const reassignedNames = new Set<string>();
  const visit = (node: ts.Node, blockedNames: ReadonlySet<string>): void => {
    if (node !== body && ts.isFunctionLike(node)) return;

    const nextBlockedNames =
      node !== body && isLexicalScopeNode(node)
        ? blockedNamesForLexicalScope(node, callableNames, blockedNames)
        : blockedNames;

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      !nextBlockedNames.has(node.expression.text)
    ) {
      const parameterName = callableParameterNames.get(node.expression.text);
      if (parameterName !== undefined) invokedNames.add(parameterName);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const aliasName = node.expression.expression;
      if (ts.isIdentifier(aliasName) && !nextBlockedNames.has(aliasName.text)) {
        const parameterName = objectAliasProperties
          .get(aliasName.text)
          ?.get(node.expression.name.text);
        if (parameterName !== undefined) invokedNames.add(parameterName);
      }
    }

    if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)) {
      const aliasName = node.expression.expression;
      if (ts.isIdentifier(aliasName) && !nextBlockedNames.has(aliasName.text)) {
        const index = staticElementIndex(node.expression.argumentExpression);
        const parameterName =
          index === undefined ? undefined : arrayAliasElements.get(aliasName.text)?.get(index);
        if (parameterName !== undefined) invokedNames.add(parameterName);
      }
    }

    for (const parameterName of invokedCallbackArrayWrapperParameters(
      node,
      arrayAliasElements,
      nextBlockedNames,
    )) {
      invokedNames.add(parameterName);
    }

    for (const parameterName of invokedCallbackArrayObjectWrapperParameters(
      node,
      arrayObjectWrapperProperties,
      nextBlockedNames,
    )) {
      invokedNames.add(parameterName);
    }

    for (const parameterName of invokedNestedCallbackArrayObjectWrapperParameters(
      node,
      nestedArrayObjectWrapperProperties,
      nextBlockedNames,
    )) {
      invokedNames.add(parameterName);
    }

    const assignedName = assignedIdentifierName(node);
    if (assignedName !== undefined && !nextBlockedNames.has(assignedName)) {
      const parameterName = callableParameterNames.get(assignedName);
      if (parameterName !== undefined) reassignedNames.add(parameterName);
    }

    const assignedProperty = assignedCallbackObjectPropertyParameter(
      node,
      objectAliasProperties,
      nextBlockedNames,
    );
    if (assignedProperty !== undefined) reassignedNames.add(assignedProperty);

    const assignedElement = assignedCallbackArrayElementParameter(
      node,
      arrayAliasElements,
      nextBlockedNames,
    );
    if (assignedElement !== undefined) reassignedNames.add(assignedElement);

    const assignedWrapperProperty = assignedCallbackArrayObjectWrapperPropertyParameter(
      node,
      arrayObjectWrapperProperties,
      nextBlockedNames,
    );
    if (assignedWrapperProperty !== undefined) reassignedNames.add(assignedWrapperProperty);

    const assignedWrapperElement = assignedCallbackArrayObjectWrapperElementParameter(
      node,
      arrayObjectWrapperProperties,
      nextBlockedNames,
    );
    if (assignedWrapperElement !== undefined) reassignedNames.add(assignedWrapperElement);

    const assignedNestedWrapperProperty = assignedNestedCallbackArrayObjectWrapperPropertyParameter(
      node,
      nestedArrayObjectWrapperProperties,
      nextBlockedNames,
    );
    if (assignedNestedWrapperProperty !== undefined) {
      reassignedNames.add(assignedNestedWrapperProperty);
    }

    const assignedNestedWrapperElement = assignedNestedCallbackArrayObjectWrapperElementParameter(
      node,
      nestedArrayObjectWrapperProperties,
      nextBlockedNames,
    );
    if (assignedNestedWrapperElement !== undefined)
      reassignedNames.add(assignedNestedWrapperElement);

    for (const unsafeParameter of unsafeCallbackObjectAliasParameters(
      node,
      objectAliasProperties,
      nextBlockedNames,
    )) {
      reassignedNames.add(unsafeParameter);
    }

    for (const unsafeParameter of unsafeCallbackArrayAliasParameters(
      node,
      arrayAliasElements,
      arrayObjectWrapperProperties,
      nextBlockedNames,
    )) {
      reassignedNames.add(unsafeParameter);
    }

    for (const unsafeParameter of unsafeCallbackArrayObjectWrapperParameters(
      node,
      arrayObjectWrapperProperties,
      nestedArrayObjectWrapperProperties,
      nextBlockedNames,
    )) {
      reassignedNames.add(unsafeParameter);
    }

    for (const unsafeParameter of unsafeNestedCallbackArrayObjectWrapperParameters(
      node,
      nestedArrayObjectWrapperProperties,
      nextBlockedNames,
    )) {
      reassignedNames.add(unsafeParameter);
    }

    ts.forEachChild(node, (child) => visit(child, nextBlockedNames));
  };

  visit(body, new Set());

  for (const reassignedName of reassignedNames) {
    invokedNames.delete(reassignedName);
  }

  return invokedNames;
}

function simpleCallbackParameterAliases(
  body: ts.ConciseBody,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  if (!ts.isBlock(body)) return new Map();

  const aliases = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

      const initializer = unwrapParentheses(declaration.initializer);
      if (!ts.isIdentifier(initializer) || !parameterNames.has(initializer.text)) continue;

      const aliasName = declaration.name.text;
      if (parameterNames.has(aliasName) || aliases.has(aliasName)) {
        aliases.delete(aliasName);
        ambiguousAliases.add(aliasName);
        continue;
      }
      if (!ambiguousAliases.has(aliasName)) aliases.set(aliasName, initializer.text);
    }
  }

  return aliases;
}

function simpleCallbackParameterObjectAliases(
  body: ts.ConciseBody,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  if (!ts.isBlock(body)) return new Map();

  const aliases = new Map<string, ReadonlyMap<string, string>>();
  const ambiguousAliases = new Set<string>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

      const initializer = unwrapParentheses(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) continue;

      const properties = callbackParameterObjectAliasProperties(initializer, parameterNames);
      if (!properties) continue;

      const aliasName = declaration.name.text;
      if (parameterNames.has(aliasName) || aliases.has(aliasName)) {
        aliases.delete(aliasName);
        ambiguousAliases.add(aliasName);
        continue;
      }
      if (!ambiguousAliases.has(aliasName)) aliases.set(aliasName, properties);
    }
  }

  return aliases;
}

function simpleCallbackParameterArrayAliases(
  body: ts.ConciseBody,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  if (!ts.isBlock(body)) return new Map();

  const aliases = new Map<string, ReadonlyMap<string, string>>();
  const ambiguousAliases = new Set<string>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

      const initializer = unwrapParentheses(declaration.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) continue;

      const elements = callbackParameterArrayAliasElements(initializer, parameterNames);
      if (!elements) continue;

      const aliasName = declaration.name.text;
      if (parameterNames.has(aliasName) || aliases.has(aliasName)) {
        aliases.delete(aliasName);
        ambiguousAliases.add(aliasName);
        continue;
      }
      if (!ambiguousAliases.has(aliasName)) aliases.set(aliasName, elements);
    }
  }

  return aliases;
}

function callbackParameterArrayAliasElements(
  expression: ts.ArrayLiteralExpression,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, string> | undefined {
  const elements = new Map<string, string>();
  for (let index = 0; index < expression.elements.length; index += 1) {
    const element = expression.elements[index];
    if (!element || ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
      return undefined;
    }

    const callback = unwrapParentheses(element);
    if (!ts.isIdentifier(callback) || !parameterNames.has(callback.text)) return undefined;

    elements.set(String(index), callback.text);
  }

  return elements.size === 0 ? undefined : elements;
}

function simpleCallbackParameterArrayObjectWrappers(
  body: ts.ConciseBody,
  arrayAliasElements: ReadonlyMap<string, ReadonlyMap<string, string>>,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, CallbackArrayObjectWrapperProperties> {
  if (!ts.isBlock(body)) return new Map();

  const wrappers = new Map<string, ReadonlyMap<string, ReadonlyMap<string, string>>>();
  const ambiguousWrappers = new Set<string>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

      const initializer = unwrapParentheses(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) continue;

      const properties = callbackParameterArrayObjectWrapperProperties(
        initializer,
        arrayAliasElements,
        parameterNames,
      );
      if (!properties) continue;

      const wrapperName = declaration.name.text;
      if (
        parameterNames.has(wrapperName) ||
        arrayAliasElements.has(wrapperName) ||
        wrappers.has(wrapperName)
      ) {
        wrappers.delete(wrapperName);
        ambiguousWrappers.add(wrapperName);
        continue;
      }
      if (!ambiguousWrappers.has(wrapperName)) wrappers.set(wrapperName, properties);
    }
  }

  return wrappers;
}

function callbackParameterArrayObjectWrapperProperties(
  expression: ts.ObjectLiteralExpression,
  arrayAliasElements: ReadonlyMap<string, ReadonlyMap<string, string>>,
  parameterNames: ReadonlySet<string>,
): CallbackArrayObjectWrapperProperties | undefined {
  const properties = new Map<string, ReadonlyMap<string, string>>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) return undefined;

    let propertyName: string | undefined;
    let initializer: ts.Expression;
    if (ts.isShorthandPropertyAssignment(property)) {
      propertyName = property.name.text;
      initializer = property.name;
    } else if (ts.isPropertyAssignment(property)) {
      if (property.name === undefined || ts.isComputedPropertyName(property.name)) return undefined;
      propertyName = staticPropertyName(property.name);
      initializer = property.initializer;
    } else {
      return undefined;
    }

    if (propertyName === undefined || properties.has(propertyName)) return undefined;

    const arrayAlias = unwrapParentheses(initializer);
    const elements = ts.isIdentifier(arrayAlias)
      ? arrayAliasElements.get(arrayAlias.text)
      : ts.isArrayLiteralExpression(arrayAlias)
        ? callbackParameterArrayAliasElements(arrayAlias, parameterNames)
        : undefined;
    if (!elements) return undefined;

    properties.set(propertyName, elements);
  }

  return properties.size === 0 ? undefined : properties;
}

function simpleCallbackParameterNestedArrayObjectWrappers(
  body: ts.ConciseBody,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, NestedCallbackArrayObjectWrapperProperties> {
  if (!ts.isBlock(body)) return new Map();

  const wrappers = new Map<string, NestedCallbackArrayObjectWrapperProperties>();
  const ambiguousWrappers = new Set<string>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

      const initializer = unwrapParentheses(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) continue;

      const properties = nestedCallbackArrayObjectWrapperProperties(
        initializer,
        arrayObjectWrapperProperties,
      );
      if (!properties) continue;

      const wrapperName = declaration.name.text;
      if (
        parameterNames.has(wrapperName) ||
        arrayObjectWrapperProperties.has(wrapperName) ||
        wrappers.has(wrapperName)
      ) {
        wrappers.delete(wrapperName);
        ambiguousWrappers.add(wrapperName);
        continue;
      }
      if (!ambiguousWrappers.has(wrapperName)) wrappers.set(wrapperName, properties);
    }
  }

  return wrappers;
}

function nestedCallbackArrayObjectWrapperProperties(
  expression: ts.ObjectLiteralExpression,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
): NestedCallbackArrayObjectWrapperProperties | undefined {
  const properties = new Map<string, CallbackArrayObjectWrapperProperties>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) return undefined;

    let propertyName: string | undefined;
    let initializer: ts.Expression;
    if (ts.isShorthandPropertyAssignment(property)) {
      propertyName = property.name.text;
      initializer = property.name;
    } else if (ts.isPropertyAssignment(property)) {
      if (property.name === undefined || ts.isComputedPropertyName(property.name)) return undefined;
      propertyName = staticPropertyName(property.name);
      initializer = property.initializer;
    } else {
      return undefined;
    }

    if (propertyName === undefined || properties.has(propertyName)) return undefined;

    const wrapperAlias = unwrapParentheses(initializer);
    if (!ts.isIdentifier(wrapperAlias)) return undefined;

    const wrapperProperties = arrayObjectWrapperProperties.get(wrapperAlias.text);
    if (!wrapperProperties) return undefined;

    properties.set(propertyName, wrapperProperties);
  }

  return properties.size === 0 ? undefined : properties;
}

function callbackParameterObjectAliasProperties(
  expression: ts.ObjectLiteralExpression,
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, string> | undefined {
  const properties = new Map<string, string>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) return undefined;

    let propertyName: string | undefined;
    let initializer: ts.Expression;
    if (ts.isShorthandPropertyAssignment(property)) {
      propertyName = property.name.text;
      initializer = property.name;
    } else if (ts.isPropertyAssignment(property)) {
      if (property.name === undefined || ts.isComputedPropertyName(property.name)) return undefined;
      propertyName = staticPropertyName(property.name);
      initializer = property.initializer;
    } else {
      return undefined;
    }

    if (propertyName === undefined || properties.has(propertyName)) return undefined;

    const callback = unwrapParentheses(initializer);
    if (!ts.isIdentifier(callback) || !parameterNames.has(callback.text)) return undefined;

    properties.set(propertyName, callback.text);
  }

  return properties.size === 0 ? undefined : properties;
}

function assignedCallbackObjectPropertyParameter(
  node: ts.Node,
  objectAliasProperties: ReadonlyMap<string, ReadonlyMap<string, string>>,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isPropertyAccessExpression(node.left)
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isPropertyAccessExpression(node.operand)
  ) {
    left = node.operand;
  }

  if (!left || !ts.isPropertyAccessExpression(left)) return undefined;

  const aliasName = left.expression;
  if (!ts.isIdentifier(aliasName) || blockedNames.has(aliasName.text)) return undefined;

  return objectAliasProperties.get(aliasName.text)?.get(left.name.text);
}

function assignedCallbackArrayElementParameter(
  node: ts.Node,
  arrayAliasElements: ReadonlyMap<string, ReadonlyMap<string, string>>,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isElementAccessExpression(node.left)
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isElementAccessExpression(node.operand)
  ) {
    left = node.operand;
  }

  if (!left || !ts.isElementAccessExpression(left)) return undefined;

  const aliasName = left.expression;
  if (!ts.isIdentifier(aliasName) || blockedNames.has(aliasName.text)) return undefined;

  const index = staticElementIndex(left.argumentExpression);
  return index === undefined ? undefined : arrayAliasElements.get(aliasName.text)?.get(index);
}

function assignedCallbackArrayObjectWrapperPropertyParameter(
  node: ts.Node,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isPropertyAccessExpression(node.left)
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isPropertyAccessExpression(node.operand)
  ) {
    left = node.operand;
  }

  if (!left || !ts.isPropertyAccessExpression(left)) return undefined;

  const wrapperName = left.expression;
  if (!ts.isIdentifier(wrapperName) || blockedNames.has(wrapperName.text)) return undefined;

  return firstCallbackParameter(
    arrayObjectWrapperProperties.get(wrapperName.text)?.get(left.name.text),
  );
}

function assignedCallbackArrayObjectWrapperElementParameter(
  node: ts.Node,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isElementAccessExpression(node.left)
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isElementAccessExpression(node.operand)
  ) {
    left = node.operand;
  }

  if (!left || !ts.isElementAccessExpression(left)) return undefined;

  const elements = callbackArrayObjectWrapperPropertyElements(
    left.expression,
    arrayObjectWrapperProperties,
    blockedNames,
  );
  if (!elements) return undefined;

  const index = staticElementIndex(left.argumentExpression);
  return index === undefined ? undefined : elements.get(index);
}

function assignedNestedCallbackArrayObjectWrapperPropertyParameter(
  node: ts.Node,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isPropertyAccessExpression(node.left)
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isPropertyAccessExpression(node.operand)
  ) {
    left = node.operand;
  }

  if (!left || !ts.isPropertyAccessExpression(left)) return undefined;

  const elements = nestedCallbackArrayObjectWrapperPropertyElements(
    left,
    nestedArrayObjectWrapperProperties,
    blockedNames,
  );
  if (elements) return firstCallbackParameter(elements);

  const nestedWrapperName = left.expression;
  if (!ts.isIdentifier(nestedWrapperName) || blockedNames.has(nestedWrapperName.text)) {
    return undefined;
  }

  return firstNestedCallbackParameter(
    nestedArrayObjectWrapperProperties.get(nestedWrapperName.text)?.get(left.name.text),
  );
}

function assignedNestedCallbackArrayObjectWrapperElementParameter(
  node: ts.Node,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isElementAccessExpression(node.left)
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isElementAccessExpression(node.operand)
  ) {
    left = node.operand;
  }

  if (!left || !ts.isElementAccessExpression(left)) return undefined;

  const elements = nestedCallbackArrayObjectWrapperPropertyElements(
    left.expression,
    nestedArrayObjectWrapperProperties,
    blockedNames,
  );
  if (!elements) return undefined;

  const index = staticElementIndex(left.argumentExpression);
  return index === undefined ? undefined : elements.get(index);
}

function unsafeCallbackObjectAliasParameters(
  node: ts.Node,
  objectAliasProperties: ReadonlyMap<string, ReadonlyMap<string, string>>,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isIdentifier(node)) return new Set();
  const properties = objectAliasProperties.get(node.text);
  if (!properties || blockedNames.has(node.text)) return new Set();

  if (
    ts.isVariableDeclaration(node.parent) &&
    node.parent.name === node &&
    ts.isIdentifier(node.parent.name)
  ) {
    return new Set();
  }

  if (
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent
  ) {
    return new Set();
  }

  return new Set(properties.values());
}

function unsafeCallbackArrayAliasParameters(
  node: ts.Node,
  arrayAliasElements: ReadonlyMap<string, ReadonlyMap<string, string>>,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isIdentifier(node)) return new Set();
  const elements = arrayAliasElements.get(node.text);
  if (!elements || blockedNames.has(node.text)) return new Set();

  if (
    ts.isVariableDeclaration(node.parent) &&
    node.parent.name === node &&
    ts.isIdentifier(node.parent.name)
  ) {
    return new Set();
  }

  if (isStaticPropertyNameIdentifier(node)) {
    return new Set();
  }

  if (
    ts.isElementAccessExpression(node.parent) &&
    node.parent.expression === node &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent &&
    staticElementIndex(node.parent.argumentExpression) !== undefined
  ) {
    return new Set();
  }

  if (isReadonlyCallbackArrayWrapperCallTarget(node, blockedNames)) {
    return new Set();
  }

  if (isCallbackArrayObjectWrapperInitializer(node, arrayObjectWrapperProperties)) {
    return new Set();
  }

  return new Set(elements.values());
}

function isStaticPropertyNameIdentifier(node: ts.Identifier): boolean {
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    return true;
  }

  if (
    (ts.isPropertyAssignment(node.parent) || ts.isShorthandPropertyAssignment(node.parent)) &&
    node.parent.name === node
  ) {
    return true;
  }

  return false;
}

function isCallbackArrayObjectWrapperInitializer(
  node: ts.Identifier,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
): boolean {
  const property = node.parent;
  let propertyName: string | undefined;
  let objectLiteral: ts.Node | undefined;

  if (ts.isShorthandPropertyAssignment(property) && property.name === node) {
    propertyName = property.name.text;
    objectLiteral = property.parent;
  } else if (ts.isPropertyAssignment(property) && property.initializer === node) {
    propertyName =
      property.name === undefined || ts.isComputedPropertyName(property.name)
        ? undefined
        : staticPropertyName(property.name);
    objectLiteral = property.parent;
  }

  if (
    propertyName === undefined ||
    !objectLiteral ||
    !ts.isObjectLiteralExpression(objectLiteral)
  ) {
    return false;
  }

  let initializer = objectLiteral.parent;
  while (
    initializer &&
    (ts.isParenthesizedExpression(initializer) ||
      ts.isAsExpression(initializer) ||
      ts.isTypeAssertionExpression(initializer) ||
      ts.isSatisfiesExpression(initializer))
  ) {
    initializer = initializer.parent;
  }
  if (!initializer || !ts.isVariableDeclaration(initializer)) return false;
  if (!ts.isIdentifier(initializer.name)) return false;

  return arrayObjectWrapperProperties.get(initializer.name.text)?.has(propertyName) ?? false;
}

function isNestedCallbackArrayObjectWrapperInitializer(
  node: ts.Identifier,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
): boolean {
  const property = node.parent;
  let propertyName: string | undefined;
  let objectLiteral: ts.Node | undefined;

  if (ts.isShorthandPropertyAssignment(property) && property.name === node) {
    propertyName = property.name.text;
    objectLiteral = property.parent;
  } else if (ts.isPropertyAssignment(property) && property.initializer === node) {
    propertyName =
      property.name === undefined || ts.isComputedPropertyName(property.name)
        ? undefined
        : staticPropertyName(property.name);
    objectLiteral = property.parent;
  }

  if (
    propertyName === undefined ||
    !objectLiteral ||
    !ts.isObjectLiteralExpression(objectLiteral)
  ) {
    return false;
  }

  let initializer = objectLiteral.parent;
  while (
    initializer &&
    (ts.isParenthesizedExpression(initializer) ||
      ts.isAsExpression(initializer) ||
      ts.isTypeAssertionExpression(initializer) ||
      ts.isSatisfiesExpression(initializer))
  ) {
    initializer = initializer.parent;
  }
  if (!initializer || !ts.isVariableDeclaration(initializer)) return false;
  if (!ts.isIdentifier(initializer.name)) return false;

  return nestedArrayObjectWrapperProperties.get(initializer.name.text)?.has(propertyName) ?? false;
}

function unsafeCallbackArrayObjectWrapperParameters(
  node: ts.Node,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isIdentifier(node)) return new Set();
  const properties = arrayObjectWrapperProperties.get(node.text);
  if (!properties || blockedNames.has(node.text)) return new Set();

  if (
    ts.isVariableDeclaration(node.parent) &&
    node.parent.name === node &&
    ts.isIdentifier(node.parent.name)
  ) {
    return new Set();
  }

  if (isStaticPropertyNameIdentifier(node)) {
    return new Set();
  }

  if (isCallbackArrayObjectWrapperSafeCallTarget(node, blockedNames)) {
    return new Set();
  }

  if (isNestedCallbackArrayObjectWrapperInitializer(node, nestedArrayObjectWrapperProperties)) {
    return new Set();
  }

  const parameterNames = new Set<string>();
  for (const elements of properties.values()) {
    for (const parameterName of elements.values()) {
      parameterNames.add(parameterName);
    }
  }

  return parameterNames;
}

function unsafeNestedCallbackArrayObjectWrapperParameters(
  node: ts.Node,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isIdentifier(node)) return new Set();
  const properties = nestedArrayObjectWrapperProperties.get(node.text);
  if (!properties || blockedNames.has(node.text)) return new Set();

  if (
    ts.isVariableDeclaration(node.parent) &&
    node.parent.name === node &&
    ts.isIdentifier(node.parent.name)
  ) {
    return new Set();
  }

  if (isStaticPropertyNameIdentifier(node)) {
    return new Set();
  }

  if (isNestedCallbackArrayObjectWrapperSafeCallTarget(node, blockedNames)) {
    return new Set();
  }

  const parameterNames = new Set<string>();
  for (const wrapperProperties of properties.values()) {
    for (const elements of wrapperProperties.values()) {
      for (const parameterName of elements.values()) {
        parameterNames.add(parameterName);
      }
    }
  }

  return parameterNames;
}

const readonlyCallbackArrayWrapperMethods = new Set(['forEach', 'map']);

function invokedCallbackArrayWrapperParameters(
  node: ts.Node,
  arrayAliasElements: ReadonlyMap<string, ReadonlyMap<string, string>>,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isCallExpression(node)) return new Set();
  if (!ts.isPropertyAccessExpression(node.expression)) return new Set();
  if (!readonlyCallbackArrayWrapperMethods.has(node.expression.name.text)) return new Set();

  const aliasName = node.expression.expression;
  if (!ts.isIdentifier(aliasName) || blockedNames.has(aliasName.text)) return new Set();

  const elements = arrayAliasElements.get(aliasName.text);
  if (!elements) return new Set();

  const [callback] = node.arguments;
  if (!callback) return new Set();

  const callbackExpression = unwrapParentheses(callback);
  if (!ts.isArrowFunction(callbackExpression) && !ts.isFunctionExpression(callbackExpression)) {
    return new Set();
  }

  const wrapperParameterName = directlyInvokedWrapperCallbackParameter(callbackExpression);
  if (wrapperParameterName === undefined) return new Set();

  const invokedParameters = new Set<string>();
  for (const parameterName of elements.values()) {
    invokedParameters.add(parameterName);
  }

  return invokedParameters;
}

function invokedCallbackArrayObjectWrapperParameters(
  node: ts.Node,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isCallExpression(node)) return new Set();

  if (ts.isElementAccessExpression(node.expression)) {
    const elements = callbackArrayObjectWrapperPropertyElements(
      node.expression.expression,
      arrayObjectWrapperProperties,
      blockedNames,
    );
    if (!elements) return new Set();

    const index = staticElementIndex(node.expression.argumentExpression);
    const parameterName = index === undefined ? undefined : elements.get(index);
    return parameterName === undefined ? new Set() : new Set([parameterName]);
  }

  if (!ts.isPropertyAccessExpression(node.expression)) return new Set();
  if (!readonlyCallbackArrayWrapperMethods.has(node.expression.name.text)) return new Set();

  const elements = callbackArrayObjectWrapperPropertyElements(
    node.expression.expression,
    arrayObjectWrapperProperties,
    blockedNames,
  );
  if (!elements) return new Set();

  const [callback] = node.arguments;
  if (!callback) return new Set();

  const callbackExpression = unwrapParentheses(callback);
  if (!ts.isArrowFunction(callbackExpression) && !ts.isFunctionExpression(callbackExpression)) {
    return new Set();
  }

  const wrapperParameterName = directlyInvokedWrapperCallbackParameter(callbackExpression);
  if (wrapperParameterName === undefined) return new Set();

  return new Set(elements.values());
}

function invokedNestedCallbackArrayObjectWrapperParameters(
  node: ts.Node,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
  blockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!ts.isCallExpression(node)) return new Set();

  if (ts.isElementAccessExpression(node.expression)) {
    const elements = nestedCallbackArrayObjectWrapperPropertyElements(
      node.expression.expression,
      nestedArrayObjectWrapperProperties,
      blockedNames,
    );
    if (!elements) return new Set();

    const index = staticElementIndex(node.expression.argumentExpression);
    const parameterName = index === undefined ? undefined : elements.get(index);
    return parameterName === undefined ? new Set() : new Set([parameterName]);
  }

  if (!ts.isPropertyAccessExpression(node.expression)) return new Set();
  if (!readonlyCallbackArrayWrapperMethods.has(node.expression.name.text)) return new Set();

  const elements = nestedCallbackArrayObjectWrapperPropertyElements(
    node.expression.expression,
    nestedArrayObjectWrapperProperties,
    blockedNames,
  );
  if (!elements) return new Set();

  const [callback] = node.arguments;
  if (!callback) return new Set();

  const callbackExpression = unwrapParentheses(callback);
  if (!ts.isArrowFunction(callbackExpression) && !ts.isFunctionExpression(callbackExpression)) {
    return new Set();
  }

  const wrapperParameterName = directlyInvokedWrapperCallbackParameter(callbackExpression);
  if (wrapperParameterName === undefined) return new Set();

  return new Set(elements.values());
}

function callbackArrayObjectWrapperPropertyElements(
  expression: ts.Expression,
  arrayObjectWrapperProperties: ReadonlyMap<string, CallbackArrayObjectWrapperProperties>,
  blockedNames: ReadonlySet<string>,
): ReadonlyMap<string, string> | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;

  const wrapperName = expression.expression;
  if (!ts.isIdentifier(wrapperName) || blockedNames.has(wrapperName.text)) return undefined;

  return arrayObjectWrapperProperties.get(wrapperName.text)?.get(expression.name.text);
}

function nestedCallbackArrayObjectWrapperPropertyElements(
  expression: ts.Expression,
  nestedArrayObjectWrapperProperties: ReadonlyMap<
    string,
    NestedCallbackArrayObjectWrapperProperties
  >,
  blockedNames: ReadonlySet<string>,
): ReadonlyMap<string, string> | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined;

  const wrapperProperty = expression.expression;
  if (!ts.isPropertyAccessExpression(wrapperProperty)) return undefined;

  const nestedWrapperName = wrapperProperty.expression;
  if (!ts.isIdentifier(nestedWrapperName) || blockedNames.has(nestedWrapperName.text)) {
    return undefined;
  }

  return nestedArrayObjectWrapperProperties
    .get(nestedWrapperName.text)
    ?.get(wrapperProperty.name.text)
    ?.get(expression.name.text);
}

function firstCallbackParameter(
  elements: ReadonlyMap<string, string> | undefined,
): string | undefined {
  return elements?.values().next().value;
}

function firstNestedCallbackParameter(
  properties: CallbackArrayObjectWrapperProperties | undefined,
): string | undefined {
  if (!properties) return undefined;

  for (const elements of properties.values()) {
    const parameterName = firstCallbackParameter(elements);
    if (parameterName !== undefined) return parameterName;
  }

  return undefined;
}

function directlyInvokedWrapperCallbackParameter(
  fn: ts.FunctionLikeDeclaration,
): string | undefined {
  const [parameter] = fn.parameters;
  if (!parameter || !ts.isIdentifier(parameter.name)) return undefined;

  const parameterName = parameter.name.text;
  const body = fn.body;
  if (!body) return undefined;

  if (
    ts.isCallExpression(body) &&
    ts.isIdentifier(body.expression) &&
    body.expression.text === parameterName
  ) {
    return parameterName;
  }

  if (!ts.isBlock(body)) return undefined;

  const aliases = simpleCallbackParameterAliases(body, new Set([parameterName]));
  const callableNames = new Map<string, string>([[parameterName, parameterName]]);
  for (const [aliasName, aliasedParameterName] of aliases) {
    callableNames.set(aliasName, aliasedParameterName);
  }

  let invoked = false;
  let reassigned = false;
  const visit = (node: ts.Node, blockedNames: ReadonlySet<string>): void => {
    if (node !== body && ts.isFunctionLike(node)) return;

    const nextBlockedNames =
      node !== body && isLexicalScopeNode(node)
        ? blockedNamesForLexicalScope(node, callableNames.keys(), blockedNames)
        : blockedNames;

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      callableNames.has(node.expression.text) &&
      !nextBlockedNames.has(node.expression.text)
    ) {
      invoked = true;
    }

    const assignedName = assignedIdentifierName(node);
    if (
      assignedName !== undefined &&
      callableNames.has(assignedName) &&
      !nextBlockedNames.has(assignedName)
    ) {
      reassigned = true;
    }

    ts.forEachChild(node, (child) => visit(child, nextBlockedNames));
  };

  visit(body, new Set());
  return invoked && !reassigned ? parameterName : undefined;
}

function isReadonlyCallbackArrayWrapperCallTarget(
  node: ts.Identifier,
  blockedNames: ReadonlySet<string>,
): boolean {
  if (blockedNames.has(node.text)) return false;
  if (!ts.isPropertyAccessExpression(node.parent)) return false;
  if (node.parent.expression !== node) return false;
  if (!readonlyCallbackArrayWrapperMethods.has(node.parent.name.text)) return false;
  return ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent;
}

function isCallbackArrayObjectWrapperSafeCallTarget(
  node: ts.Identifier,
  blockedNames: ReadonlySet<string>,
): boolean {
  if (blockedNames.has(node.text)) return false;
  if (!ts.isPropertyAccessExpression(node.parent)) return false;
  if (node.parent.expression !== node) return false;

  if (
    ts.isElementAccessExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent &&
    ts.isCallExpression(node.parent.parent.parent) &&
    node.parent.parent.parent.expression === node.parent.parent &&
    staticElementIndex(node.parent.parent.argumentExpression) !== undefined
  ) {
    return true;
  }

  if (
    ts.isPropertyAccessExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent &&
    readonlyCallbackArrayWrapperMethods.has(node.parent.parent.name.text)
  ) {
    return (
      ts.isCallExpression(node.parent.parent.parent) &&
      node.parent.parent.parent.expression === node.parent.parent
    );
  }

  return false;
}

function isNestedCallbackArrayObjectWrapperSafeCallTarget(
  node: ts.Identifier,
  blockedNames: ReadonlySet<string>,
): boolean {
  if (blockedNames.has(node.text)) return false;
  if (!ts.isPropertyAccessExpression(node.parent)) return false;
  if (node.parent.expression !== node) return false;

  const wrapperProperty = node.parent.parent;
  if (!ts.isPropertyAccessExpression(wrapperProperty)) return false;
  if (wrapperProperty.expression !== node.parent) return false;

  if (
    ts.isElementAccessExpression(wrapperProperty.parent) &&
    wrapperProperty.parent.expression === wrapperProperty &&
    ts.isCallExpression(wrapperProperty.parent.parent) &&
    wrapperProperty.parent.parent.expression === wrapperProperty.parent &&
    staticElementIndex(wrapperProperty.parent.argumentExpression) !== undefined
  ) {
    return true;
  }

  if (
    ts.isPropertyAccessExpression(wrapperProperty.parent) &&
    wrapperProperty.parent.expression === wrapperProperty &&
    readonlyCallbackArrayWrapperMethods.has(wrapperProperty.parent.name.text)
  ) {
    return (
      ts.isCallExpression(wrapperProperty.parent.parent) &&
      wrapperProperty.parent.parent.expression === wrapperProperty.parent
    );
  }

  return false;
}

function isLexicalScopeNode(node: ts.Node): boolean {
  return (
    ts.isBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCaseClause(node) ||
    ts.isDefaultClause(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  );
}

function blockedNamesForLexicalScope(
  node: ts.Node,
  callableNames: Iterable<string>,
  inheritedBlockedNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const scopeBindingNames = new Set<string>();
  collectLexicalScopeBindingNames(node, scopeBindingNames);

  let blockedNames: Set<string> | undefined;
  for (const callableName of callableNames) {
    if (!scopeBindingNames.has(callableName)) continue;

    blockedNames ??= new Set(inheritedBlockedNames);
    blockedNames.add(callableName);
  }

  return blockedNames ?? inheritedBlockedNames;
}

function collectLexicalScopeBindingNames(node: ts.Node, names: Set<string>): void {
  const visit = (child: ts.Node): void => {
    if (child !== node && ts.isFunctionLike(child)) return;

    if (ts.isVariableDeclaration(child)) {
      collectBindingNames(child.name, names);
      return;
    }

    if (ts.isFunctionDeclaration(child) && child.name) {
      names.add(child.name.text);
      return;
    }

    if (ts.isCatchClause(child) && child.variableDeclaration) {
      collectBindingNames(child.variableDeclaration.name, names);
    }

    ts.forEachChild(child, visit);
  };

  visit(node);
}

function assignedIdentifierName(node: ts.Node): string | undefined {
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    ts.isIdentifier(node.left)
  ) {
    return node.left.text;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    ts.isIdentifier(node.operand)
  ) {
    return node.operand.text;
  }

  return undefined;
}

function isAssignedBinding(sourceFile: ts.SourceFile, name: string): boolean {
  let assigned = false;

  const visit = (node: ts.Node): void => {
    if (assigned) return;

    const assignedName = assignedIdentifierName(node);
    if (assignedName === name) {
      assigned = true;
      return;
    }

    if (assignedPropertyBaseName(node) === name) {
      assigned = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return assigned;
}

function assignedPropertyBaseName(node: ts.Node): string | undefined {
  let left: ts.Expression | undefined;
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind) &&
    (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
  ) {
    left = node.left;
  }

  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken) &&
    (ts.isPropertyAccessExpression(node.operand) || ts.isElementAccessExpression(node.operand))
  ) {
    left = node.operand;
  }

  if (!left || (!ts.isPropertyAccessExpression(left) && !ts.isElementAccessExpression(left))) {
    return undefined;
  }
  const base = left.expression;
  return ts.isIdentifier(base) ? base.text : undefined;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  switch (kind) {
    case ts.SyntaxKind.FirstAssignment:
    case ts.SyntaxKind.PlusEqualsToken:
    case ts.SyntaxKind.MinusEqualsToken:
    case ts.SyntaxKind.AsteriskEqualsToken:
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
    case ts.SyntaxKind.SlashEqualsToken:
    case ts.SyntaxKind.PercentEqualsToken:
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.AmpersandEqualsToken:
    case ts.SyntaxKind.BarEqualsToken:
    case ts.SyntaxKind.CaretEqualsToken:
    case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
    case ts.SyntaxKind.BarBarEqualsToken:
    case ts.SyntaxKind.QuestionQuestionEqualsToken:
      return true;
    default:
      return false;
  }
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function staticHelperAliasInitializer(
  expression: ts.Expression,
  moduleFacts: ModuleFacts,
): ts.Expression {
  const initializer = unwrapParentheses(expression);
  if (!ts.isCallExpression(initializer)) return initializer;
  if (initializer.arguments.length !== 1) return initializer;

  const callee = initializer.expression;
  if (!ts.isPropertyAccessExpression(callee)) return initializer;
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'Object') {
    return initializer;
  }
  if (callee.name.text !== 'freeze') return initializer;
  if (moduleFacts.topLevelBindings.has('Object')) return initializer;

  const [argument] = initializer.arguments;
  return argument ? unwrapParentheses(argument) : initializer;
}

function staticFrozenExistingAliasName(
  expression: ts.Expression,
  moduleFacts: ModuleFacts,
): string | undefined {
  const initializer = unwrapParentheses(expression);
  if (!ts.isCallExpression(initializer)) return undefined;
  if (initializer.arguments.length !== 1) return undefined;

  const callee = initializer.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'Object') {
    return undefined;
  }
  if (callee.name.text !== 'freeze') return undefined;
  if (moduleFacts.topLevelBindings.has('Object')) return undefined;

  const [argument] = initializer.arguments;
  if (!argument) return undefined;

  const alias = unwrapParentheses(argument);
  if (!ts.isIdentifier(alias)) return undefined;
  if (isAssignedBinding(moduleFacts.sourceFile, alias.text)) return undefined;

  return alias.text;
}

function namesBlockedInFunctionBody(
  fn: ts.FunctionLikeDeclaration,
  topLevelBindings: ReadonlySet<string>,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const parameter of fn.parameters) {
    collectBindingNames(parameter.name, names);
  }

  const body = fn.body;
  if (!body) return names;

  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      collectBindingNames(node.name, names);
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      names.add(node.name.text);
      return;
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(node.variableDeclaration.name, names);
    }

    ts.forEachChild(node, visit);
  };

  visit(body);

  for (const globalName of ['fetch', 'process']) {
    if (topLevelBindings.has(globalName)) names.add(globalName);
  }

  return names;
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingNames(element.name, names);
  }
}

function calledHelper(
  node: ts.Node,
  moduleFacts: ModuleFacts,
  blockedNames: ReadonlySet<string>,
): HelperDefinition | undefined {
  if (!ts.isCallExpression(node)) return undefined;

  const expression = staticCallTargetExpression(node);

  if (ts.isElementAccessExpression(expression)) {
    const aliasName = staticAccessBaseExpression(expression.expression);
    if (!ts.isIdentifier(aliasName)) return undefined;
    if (blockedNames.has(aliasName.text)) return undefined;

    const index = staticElementIndex(expression.argumentExpression);
    if (index === undefined) return undefined;

    return moduleFacts.arrayAliasHelpers.get(aliasName.text)?.get(index);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const nestedHelper = nestedObjectAliasHelper(expression, moduleFacts, blockedNames);
    if (nestedHelper) return nestedHelper;

    const namespaceName = staticAccessBaseExpression(expression.expression);
    if (!ts.isIdentifier(namespaceName)) return undefined;
    if (blockedNames.has(namespaceName.text)) return undefined;

    const namespaceHelpers =
      moduleFacts.objectAliasHelpers.get(namespaceName.text) ??
      moduleFacts.namespaceImports.get(namespaceName.text);
    return namespaceHelpers?.get(expression.name.text);
  }

  if (!ts.isIdentifier(expression)) return undefined;

  const name = expression.text;
  if (blockedNames.has(name)) return undefined;
  return moduleFacts.helpers.get(name);
}

function staticCallTargetExpression(node: ts.CallExpression): ts.Expression {
  return unwrapParentheses(node.expression);
}

function staticAccessBaseExpression(expression: ts.Expression): ts.Expression {
  return unwrapParentheses(expression);
}

function nestedObjectAliasHelper(
  expression: ts.PropertyAccessExpression,
  moduleFacts: ModuleFacts,
  blockedNames: ReadonlySet<string>,
): HelperDefinition | undefined {
  const wrapperProperty = staticAccessBaseExpression(expression.expression);
  if (!ts.isPropertyAccessExpression(wrapperProperty)) return undefined;

  const wrapperName = staticAccessBaseExpression(wrapperProperty.expression);
  if (!ts.isIdentifier(wrapperName)) return undefined;
  if (blockedNames.has(wrapperName.text)) return undefined;

  return moduleFacts.nestedObjectAliasHelpers
    .get(wrapperName.text)
    ?.get(wrapperProperty.name.text)
    ?.get(expression.name.text);
}

function staticElementIndex(expression: ts.Expression): string | undefined {
  if (!ts.isNumericLiteral(expression)) return undefined;

  const index = Number(expression.text);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== expression.text) {
    return undefined;
  }

  return expression.text;
}

function egressSinkFact(
  sourceFile: ts.SourceFile,
  tool: string,
  node: ts.Node,
  blockedNames: ReadonlySet<string>,
  origin: AgentToolSinkOrigin,
): CoreGraph.AgentToolReachableSinkFact | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  if (!isFetchCallee(staticCallTargetExpression(node), blockedNames)) return undefined;

  const [url] = node.arguments;
  if (!url || !ts.isStringLiteralLike(url)) return undefined;

  const target = urlHost(url.text);
  if (target === undefined) return undefined;

  return {
    capability: `egress:${target}`,
    evidence: egressEvidence(origin),
    grade: sinkGrade(origin),
    kind: 'egress',
    site: siteForNode(sourceFile, node),
    target,
    tool,
  };
}

/** Global-object aliases whose `fetch` member reaches the same outbound-egress sink as bare `fetch`. */
const globalThisAliasNames: ReadonlySet<string> = new Set(['globalThis', 'window', 'self']);

/**
 * SPEC §6.6: recognize the outbound-egress callee. A bare `fetch` (unless shadowed) and the
 * `globalThis.fetch` / `window.fetch` / `self.fetch` member forms all reach the same sink. The
 * `fetch` property of the global object is not shadowable by a local `fetch` binding, so only a
 * shadowed global *base* (e.g. a local `globalThis`) disqualifies the member form.
 */
function isFetchCallee(expression: ts.Expression, blockedNames: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'fetch' && !blockedNames.has('fetch');
  }

  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'fetch') {
    const base = staticAccessBaseExpression(expression.expression);
    return (
      ts.isIdentifier(base) && globalThisAliasNames.has(base.text) && !blockedNames.has(base.text)
    );
  }

  return false;
}

function secretReadSinkFact(
  sourceFile: ts.SourceFile,
  tool: string,
  node: ts.Node,
  blockedNames: ReadonlySet<string>,
  origin: AgentToolSinkOrigin,
): CoreGraph.AgentToolReachableSinkFact | undefined {
  const name = processEnvSecretName(node, blockedNames);
  if (name === undefined) return undefined;

  const target = `env.${name}`;
  return {
    capability: 'secrets.read',
    evidence: secretReadEvidence(origin),
    grade: sinkGrade(origin),
    kind: 'secret-read',
    site: siteForNode(sourceFile, node),
    target,
    tool,
  };
}

/**
 * SPEC §6.6: name the secret read by a `process.env` access. Both the `process.env.NAME` property
 * form and the `process.env['NAME']` element-access form (with a string-literal key) reach the same
 * secret-read sink.
 */
function processEnvSecretName(
  node: ts.Node,
  blockedNames: ReadonlySet<string>,
): string | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return isProcessEnvAccess(node.expression, blockedNames) ? node.name.text : undefined;
  }

  if (ts.isElementAccessExpression(node)) {
    if (!isProcessEnvAccess(node.expression, blockedNames)) return undefined;
    const key = unwrapParentheses(node.argumentExpression);
    return ts.isStringLiteralLike(key) ? key.text : undefined;
  }

  return undefined;
}

/** True when `expression` is `process.env` (property or `process['env']` element access). */
function isProcessEnvAccess(expression: ts.Expression, blockedNames: ReadonlySet<string>): boolean {
  const env = unwrapParentheses(expression);

  let base: ts.Expression | undefined;
  if (ts.isPropertyAccessExpression(env) && env.name.text === 'env') {
    base = env.expression;
  } else if (ts.isElementAccessExpression(env)) {
    const key = unwrapParentheses(env.argumentExpression);
    if (ts.isStringLiteralLike(key) && key.text === 'env') base = env.expression;
  }
  if (base === undefined) return false;

  const root = unwrapParentheses(base);
  return ts.isIdentifier(root) && root.text === 'process' && !blockedNames.has('process');
}

/**
 * SPEC §6.6 rule 3: distinguish by-construction (sound, `kovo check`-enforced) from defense-in-depth
 * (audit, visible in `kovo explain --capabilities` only). Sinks reached through a callback handed to
 * an unanalyzable callee cannot be proven invoked, so they are audit-grade: the blast radius stays
 * visible without claiming a by-construction reachability bound.
 */
function sinkGrade(origin: AgentToolSinkOrigin): 'audit' | 'sound' {
  return origin === 'nested-callback' ? 'audit' : 'sound';
}

function egressEvidence(origin: AgentToolSinkOrigin): string {
  switch (origin) {
    case 'handler':
      return 'static-tool-body-fetch';
    case 'helper':
      return 'static-tool-helper-fetch';
    case 'imported-helper':
      return 'static-tool-imported-helper-fetch';
    case 'inline':
      return 'static-tool-inline-fetch';
    case 'nested-callback':
      return 'static-tool-nested-callback-fetch';
  }
}

function secretReadEvidence(origin: AgentToolSinkOrigin): string {
  switch (origin) {
    case 'handler':
      return 'static-tool-body-env';
    case 'helper':
      return 'static-tool-helper-env';
    case 'imported-helper':
      return 'static-tool-imported-helper-env';
    case 'inline':
      return 'static-tool-inline-env';
    case 'nested-callback':
      return 'static-tool-nested-callback-env';
  }
}

function handlerTarget(
  definition: ts.ObjectLiteralExpression,
  moduleFacts: ModuleFacts,
): HandlerTarget | undefined {
  const property = propertyNamed(definition, 'handler');
  if (property === undefined) return undefined;

  if (ts.isMethodDeclaration(property)) {
    return { moduleFacts, node: property, origin: 'handler' };
  }

  if (ts.isShorthandPropertyAssignment(property)) {
    return helperHandlerTarget(property.name.text, moduleFacts);
  }

  if (!ts.isPropertyAssignment(property)) return undefined;

  const initializer = property.initializer;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return { moduleFacts, node: initializer, origin: 'handler' };
  }

  if (ts.isIdentifier(initializer)) return helperHandlerTarget(initializer.text, moduleFacts);

  return undefined;
}

function helperHandlerTarget(name: string, moduleFacts: ModuleFacts): HandlerTarget | undefined {
  const helper = moduleFacts.helpers.get(name);
  if (!helper) return undefined;

  return {
    moduleFacts: helper.moduleFacts,
    node: helper.node,
    origin:
      helper.moduleFacts.sourceFile === moduleFacts.sourceFile ? 'handler' : 'imported-helper',
  };
}

function stringPropertyValue(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = propertyNamed(object, propertyName);
  if (!property || !ts.isPropertyAssignment(property)) return undefined;
  const initializer = property.initializer;
  return ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => {
    const name = property.name;
    return name !== undefined && ts.isIdentifier(name) && name.text === propertyName;
  });
}

function isIdentifierNamed(node: ts.Expression, names: ReadonlySet<string>): boolean {
  return ts.isIdentifier(node) && names.has(node.text);
}

function urlHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return undefined;
  }
}

function siteForNode(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

function compareAgentToolSinkFact(
  left: CoreGraph.AgentToolReachableSinkFact,
  right: CoreGraph.AgentToolReachableSinkFact,
): number {
  return (
    left.tool.localeCompare(right.tool) ||
    left.kind.localeCompare(right.kind) ||
    left.target.localeCompare(right.target) ||
    left.site.localeCompare(right.site)
  );
}

function uniqueAgentToolSinkFacts(
  facts: readonly CoreGraph.AgentToolReachableSinkFact[],
): CoreGraph.AgentToolReachableSinkFact[] {
  const seen = new Set<string>();
  const unique: CoreGraph.AgentToolReachableSinkFact[] = [];

  for (const fact of facts) {
    const key = [
      fact.tool,
      fact.kind,
      fact.target,
      fact.capability,
      fact.site,
      fact.evidence ?? '',
      fact.grade,
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }

  return unique;
}
