import * as ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';
import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { ensureTypescriptRuntime } from '../ts-api.js';
import { propertyNameText, unwrapExpression } from './ast.js';

ensureTypescriptRuntime(ts);

const ENDPOINT_IDENTITY = frameworkExport('@kovojs/server', 'endpoint');
const LAYOUT_IDENTITY = frameworkExport('@kovojs/server', 'layout');
const MUTATION_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
const ROUTE_IDENTITY = frameworkExport('@kovojs/server', 'route');
const WEBHOOK_IDENTITY = frameworkExport('@kovojs/server', 'webhook');

const SURFACES = [
  { identity: ENDPOINT_IDENTITY, legacyGuard: 'unsupported', name: 'endpoint' },
  { identity: LAYOUT_IDENTITY, legacyGuard: 'fallback', name: 'layout' },
  { identity: MUTATION_IDENTITY, legacyGuard: 'fallback', name: 'mutation' },
  { identity: QUERY_IDENTITY, legacyGuard: 'fallback', name: 'query' },
  { identity: ROUTE_IDENTITY, legacyGuard: 'fallback', name: 'route' },
  { identity: WEBHOOK_IDENTITY, legacyGuard: 'unsupported', name: 'webhook' },
] as const;

const LEGACY_GLOBALS = [
  ENDPOINT_IDENTITY,
  LAYOUT_IDENTITY,
  MUTATION_IDENTITY,
  QUERY_IDENTITY,
  ROUTE_IDENTITY,
  WEBHOOK_IDENTITY,
] as const;

interface AccessGuardPropertyFacts {
  access?: ts.ObjectLiteralElementLike;
  guard?: ts.ObjectLiteralElementLike;
}

interface ModuleStaticBindings {
  readonly objects: ReadonlyMap<string, ts.Expression>;
  readonly strings: ReadonlyMap<string, string>;
}

/**
 * Find request-surface definitions with an ambiguous or unsupported legacy executable `guard`.
 * Query/mutation/route/layout keep their guard-only fallback but cannot also declare §10.2
 * `access`; endpoint/webhook have no fallback and reject `guard` outright. The build must never
 * audit one decision while dispatch silently enforces a different one, so these shapes are KV436.
 */
export function accessGuardExclusivityDiagnostics(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
): readonly CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const bindings = moduleStaticBindings(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const surface = requestSurfaceForCall(sourceFile, node);
      if (surface !== undefined) {
        const definition = requestSurfaceDefinition(node, bindings.objects);
        if (definition !== undefined) {
          const fields = accessGuardProperties(definition, bindings, compilerCreateSet());
          const guard = fields.guard;
          const conflict = fields.access !== undefined && guard !== undefined;
          const unsupportedGuard = surface.legacyGuard === 'unsupported' && guard !== undefined;
          if (guard !== undefined && (conflict || unsupportedGuard)) {
            const start = guard.getStart(sourceFile);
            const diagnostic = diagnosticFor(
              fileName,
              'KV436',
              source,
              start,
              guard.getWidth(sourceFile),
            );
            compilerArrayAppend(
              diagnostics,
              {
                ...diagnostic,
                help:
                  surface.legacyGuard === 'unsupported'
                    ? unsupportedGuardHelp(surface.name)
                    : conflictingGuardHelp(surface.name),
                message:
                  surface.legacyGuard === 'unsupported'
                    ? `Unsupported access decision: ${surface.name}() cannot declare legacy guard.`
                    : `Conflicting access decisions: ${surface.name}() cannot declare both access and legacy guard.`,
              },
              'Compiler access/guard exclusivity diagnostics',
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}

function requestSurfaceForCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): (typeof SURFACES)[number] | undefined {
  const count = compilerArrayLength(SURFACES, 'Compiler request-surface identities');
  for (let index = 0; index < count; index += 1) {
    const surface = compilerOwnDataValue(
      SURFACES,
      index,
      'Compiler request-surface identities',
    ) as (typeof SURFACES)[number];
    if (resolvesTo(sourceFile, call.expression, surface.identity)) return surface;
  }
  return undefined;
}

function conflictingGuardHelp(surface: string): string {
  return [
    'Would lower to: one access decision whose named executable guards are the same guards runtime dispatch enforces.',
    `Blocked reason: ${surface}() declares both access and legacy guard, so selecting either property would make the other security decision unaudited or unenforced.`,
    'Fixes: move the legacy guard into access: [guard("name", legacyGuard), ...] and remove guard, or remove access and keep the guard-only compatibility posture.',
    'SPEC §10.2 requires the audited access decision to be the enforced decision; KV436 fails closed when that decision is ambiguous.',
  ].join('\n');
}

function unsupportedGuardHelp(surface: 'endpoint' | 'webhook'): string {
  return [
    'Would lower to: an endpoint or webhook whose machine-auth/access declaration is the only executable request-boundary decision.',
    `Blocked reason: ${surface}() has no legacy guard fallback; a guard property is unsupported and cannot become an audited runtime decision.`,
    'Fixes: move the executable guard into access: [guard("name", legacyGuard)], or use endpoint auth / webhook verify for machine authentication.',
    'SPEC §10.2 requires every request surface to carry one audited decision that runtime dispatch actually enforces.',
  ].join('\n');
}

function resolvesTo(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  identity: FrameworkExportIdentity,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    identity,
    { legacyGlobals: LEGACY_GLOBALS },
  );
}

function requestSurfaceDefinition(
  call: ts.CallExpression,
  objectBindings: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const count = compilerArrayLength(call.arguments, 'Compiler request-surface arguments');
  if (count === 0) return undefined;
  const candidate = compilerOwnDataValue(
    call.arguments,
    count - 1,
    'Compiler request-surface arguments',
  ) as ts.Expression;
  return resolveStaticObject(candidate, objectBindings, compilerCreateSet());
}

function resolveStaticObject(
  expression: ts.Expression,
  objectBindings: ReadonlyMap<string, ts.Expression>,
  seen: Set<ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (compilerSetHas(seen, unwrapped)) return undefined;
  compilerSetAdd(seen, unwrapped);
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped;
  if (!ts.isIdentifier(unwrapped)) return undefined;
  const binding = compilerMapGet(objectBindings, unwrapped.text);
  return binding === undefined ? undefined : resolveStaticObject(binding, objectBindings, seen);
}

function accessGuardProperties(
  object: ts.ObjectLiteralExpression,
  bindings: ModuleStaticBindings,
  seen: Set<ts.ObjectLiteralExpression>,
): AccessGuardPropertyFacts {
  if (compilerSetHas(seen, object)) return {};
  compilerSetAdd(seen, object);
  const result: AccessGuardPropertyFacts = {};
  const count = compilerArrayLength(object.properties, 'Compiler request-surface properties');
  for (let index = 0; index < count; index += 1) {
    const property = compilerOwnDataValue(
      object.properties,
      index,
      'Compiler request-surface properties',
    ) as ts.ObjectLiteralElementLike;
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveStaticObject(
        property.expression,
        bindings.objects,
        compilerCreateSet(),
      );
      if (spread === undefined) continue;
      const spreadFacts = accessGuardProperties(spread, bindings, seen);
      if (result.access === undefined && spreadFacts.access !== undefined) {
        result.access = spreadFacts.access;
      }
      if (result.guard === undefined && spreadFacts.guard !== undefined) {
        result.guard = spreadFacts.guard;
      }
      continue;
    }

    const name = propertyNameText(property.name, { staticStringValues: bindings.strings });
    if (name === 'access') result.access ??= property;
    if (name === 'guard') result.guard ??= property;
  }
  return result;
}

function moduleStaticBindings(sourceFile: ts.SourceFile): ModuleStaticBindings {
  const objects = compilerCreateMap<string, ts.Expression>();
  const strings = compilerCreateMap<string, string>();
  const statements = sourceFile.statements;
  const statementCount = compilerArrayLength(statements, 'Compiler module statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      statements,
      statementIndex,
      'Compiler module statements',
    ) as ts.Statement;
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    const declarations = statement.declarationList.declarations;
    const declarationCount = compilerArrayLength(declarations, 'Compiler module declarations');
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        declarations,
        declarationIndex,
        'Compiler module declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = unwrapExpression(declaration.initializer);
      compilerMapSet(objects, declaration.name.text, initializer);
    }
  }
  compilerMapForEach(objects, (initializer, name) => {
    const value = resolveStaticString(initializer, objects, compilerCreateSet());
    if (value !== undefined) compilerMapSet(strings, name, value);
  });
  return { objects, strings };
}

function resolveStaticString(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen: Set<ts.Expression>,
): string | undefined {
  const unwrapped = unwrapExpression(expression);
  if (compilerSetHas(seen, unwrapped)) return undefined;
  compilerSetAdd(seen, unwrapped);
  if (ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  if (!ts.isIdentifier(unwrapped)) return undefined;
  const binding = compilerMapGet(bindings, unwrapped.text);
  return binding === undefined ? undefined : resolveStaticString(binding, bindings, seen);
}
