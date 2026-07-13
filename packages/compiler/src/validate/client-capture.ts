import * as ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { PublishToClientFact } from '../types.js';
import { isCompilerAuditText } from '../security/audit-text.js';

/**
 * SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0 item 3: gate the named-import
 * handler-closure secret-emit channel.
 *
 * The probe-confirmed live hole: a client handler such as `() => sendPayment(STRIPE_SECRET_KEY)`
 * captures a cross-module import; lowering re-emits `import { STRIPE_SECRET_KEY } from "…"` verbatim
 * into the `*.client.js` module, so the bundler resolves and INLINES the evaluated secret into the
 * browser bundle. KV435 covers only the query wire, not this channel.
 *
 * The gate is **whole-channel and fail-closed by construction**, not a narrow `process.env`/`Secret`
 * brand check. The compiler has no CallExpression provenance (a call-wrapped secret —
 * `publishKey(loadSecret())` — escapes a brand check), so we cannot soundly decide "this binding is
 * a secret". Instead we refuse to ship the EVALUATED VALUE of ANY captured cross-module import into
 * the client unless it is provably client-safe:
 *
 *   - **callee-position only** — the import is INVOKED (`track(x)`, `keyDown(event, …)`). The
 *     browser runs the function; its identity, not its evaluated value, is what crosses. This is
 *     ordinary client logic (the de-facto contract for `./analytics`/`@kovojs/headless-ui`), so it
 *     is client-safe to emit.
 *   - **publishToClient(value, { reason })** — an author assertion (audit-grade, NOT statically
 *     checked) that a value-position captured import is safe to ship. The capture is allowed to
 *     emit and the site+reason are recorded for `kovo explain --capabilities`.
 *
 * Every other value-position capture (call argument, bare operand, member object, spread, …) is a
 * potential serialized-secret channel and is refused: KV437 at the capture site, and the import
 * specifier is withheld from the emitted `*.client.js` (the by-construction half lives in
 * lower/handlers.ts, which consumes {@link emitAllowedImportLocalNames}).
 *
 * Honest ceiling (documented for the handoff): a callee-position function import whose own module
 * transitively reads a server secret is a different, far weaker channel — it requires that module to
 * be client-bundlable at all, the same trust the author already extends to every client util. This
 * gate closes the inlined-value channel, not arbitrary cross-module code trust.
 */

const PUBLISH_TO_CLIENT_IDENTITY = frameworkExport('@kovojs/core', 'publishToClient');
const PUBLISH_TO_CLIENT_REASON_PROPERTY = 'reason';

interface ImportBinding {
  source: 'import';
  /** Local name the handler closure can reference. */
  localName: string;
  /** Named / default / namespace — covers all laundering forms the threat model lists. */
  kind: 'named' | 'default' | 'namespace';
  importedName: string;
  /** Surface module specifier (followed only as a label; the binding itself is the resolved fact). */
  moduleSpecifier: string;
}

interface ModuleConstantBinding {
  source: 'module-constant';
  /** Local name the handler closure can reference. */
  localName: string;
}

type CaptureBinding = ImportBinding | ModuleConstantBinding;

interface CaptureUse {
  binding: CaptureBinding;
  /** True when the import is the callee of a call expression (client-safe code). */
  callee: boolean;
  /** True when this value-position use is the first arg of a recognized publishToClient(...) call. */
  published: boolean;
  start: number;
  length: number;
}

export interface ClientCaptureAnalysis {
  /** Un-wrapped value-position captures: each is a KV437 site. */
  unsafeUses: readonly CaptureUse[];
  /** Audited publishToClient escapes recorded for the capabilities ledger. */
  publishFacts: readonly PublishToClientFact[];
  /** Import local names whose every value-position use is callee-only or published → safe to emit. */
  emitAllowed: ReadonlySet<string>;
  /** Same-file module constants whose every value-position use is publishToClient-wrapped. */
  emitAllowedModuleConstants: ReadonlySet<string>;
}

/**
 * Collect every import binding the module declares, in all three forms the laundering threat model
 * names. We follow the RESOLVED binding (the local name a handler can capture), not the surface
 * specifier, so a barrel/re-export cannot bypass the gate: re-exporting a secret through `index.ts`
 * still produces a captured local binding here.
 */
function importBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  const statementLength = compilerArrayLength(sourceFile.statements, 'Client-capture statements');
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Client-capture statements',
    ) as ts.Statement | undefined;
    if (!statement)
      throw new TypeError(`Client-capture statements[${statementIndex}] must be dense.`);
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;

    if (clause.name) {
      compilerArrayAppend(
        bindings,
        {
          importedName: 'default',
          kind: 'default',
          localName: clause.name.text,
          moduleSpecifier,
          source: 'import',
        },
        'Client-capture import bindings',
      );
    }

    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      compilerArrayAppend(
        bindings,
        {
          importedName: '*',
          kind: 'namespace',
          localName: named.name.text,
          moduleSpecifier,
          source: 'import',
        },
        'Client-capture import bindings',
      );
    } else if (named && ts.isNamedImports(named)) {
      const elementLength = compilerArrayLength(named.elements, 'Client-capture named imports');
      for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
        const element = compilerOwnDataValue(
          named.elements,
          elementIndex,
          'Client-capture named imports',
        ) as ts.ImportSpecifier | undefined;
        if (!element) {
          throw new TypeError(`Client-capture named imports[${elementIndex}] must be dense.`);
        }
        compilerArrayAppend(
          bindings,
          {
            importedName: element.propertyName?.text ?? element.name.text,
            kind: 'named',
            localName: element.name.text,
            moduleSpecifier,
            source: 'import',
          },
          'Client-capture import bindings',
        );
      }
    }
  }

  return bindings;
}

function moduleConstantBindings(model: ComponentModuleModel): ModuleConstantBinding[] {
  const bindings: ModuleConstantBinding[] = [];
  const length = compilerArrayLength(model.moduleScopeBindings, 'Module-scope capture bindings');
  for (let index = 0; index < length; index += 1) {
    const binding = compilerOwnDataValue(
      model.moduleScopeBindings,
      index,
      'Module-scope capture bindings',
    ) as { name?: unknown } | undefined;
    if (!binding || typeof binding.name !== 'string') {
      throw new TypeError(`Module-scope capture bindings[${index}] must have an own name.`);
    }
    compilerArrayAppend(
      bindings,
      { localName: binding.name, source: 'module-constant' },
      'Client-capture module-constant bindings',
    );
  }
  return bindings;
}

/** Every event-handler arrow body in the module (the closures lowered into the client bundle). */
function handlerArrowBodies(sourceFile: ts.SourceFile): ts.Node[] {
  const bodies: ts.Node[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      isDomEventName(node.name.text) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      const expression = node.initializer.expression;
      if (ts.isArrowFunction(expression) && expression.parameters.length === 0) {
        compilerArrayAppend(bodies, expression.body, 'Client-capture handler bodies');
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return bodies;
}

// React-style camelCase DOM handler attributes (onClick, onKeyDown, …). Mirrors the lowering's
// own `jsxDomEventName` recognition exactly, so the gate analyzes precisely the closures that are
// lowered into the client bundle — no more, no less.
function isDomEventName(name: string): boolean {
  return compilerRegExpTest(/^on[A-Z][A-Za-z0-9]*$/, name);
}

/**
 * Classify, within one handler body, every captured-import identifier as callee-position (safe),
 * publishToClient-wrapped (audited escape), or an un-wrapped value-position use (the leak).
 */
function classifyCaptures(
  body: ts.Node,
  bindingByName: ReadonlyMap<string, CaptureBinding>,
  fileName: string,
  uses: CaptureUse[],
  publishFacts: PublishToClientFact[],
): void {
  // Identifiers declared locally inside the handler shadow a module import of the same name; track
  // them so a local `const track = …` is never mistaken for the captured import.
  const shadowed = compilerCreateSet<string>();
  collectLocalDeclarations(body, shadowed);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
      const binding = compilerMapGet(bindingByName as Map<string, CaptureBinding>, node.text);
      if (binding && !compilerSetHas(shadowed, node.text)) {
        const parent = node.parent;
        const callee = isCalleeReferenceIdentifier(node);
        const publishReason = isPublishToClientArgument(node, parent)
          ? publishToClientReason(parent as ts.CallExpression)
          : null;
        // SPEC §6.6: the exact recorded reason must remain unambiguous in source,
        // `kovo explain`, CI logs, and review tooling.
        const published = publishReason !== null && isCompilerAuditText(publishReason);
        if (published) {
          compilerArrayAppend(
            publishFacts,
            {
              fileName,
              localName: binding.localName,
              moduleSpecifier:
                binding.source === 'import' ? binding.moduleSpecifier : `${fileName}#module-scope`,
              reason: publishReason,
              site: sourceSite(fileName, body.getSourceFile(), node.getStart()),
              start: node.getStart(),
            },
            'Client-capture publish facts',
          );
        }
        compilerArrayAppend(
          uses,
          {
            binding,
            callee,
            length: node.getEnd() - node.getStart(),
            published,
            start: node.getStart(),
          },
          'Client-capture uses',
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
}

function isCalleeReferenceIdentifier(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  let parent = current.parent;
  while (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
    current = parent;
    parent = current.parent;
  }
  return !!parent && ts.isCallExpression(parent) && parent.expression === current;
}

/** True when `node` is the first argument of a `publishToClient(value, …)` call. */
function isPublishToClientArgument(node: ts.Identifier, parent: ts.Node): boolean {
  if (!ts.isCallExpression(parent)) return false;
  if (parent.arguments[0] !== node) return false;
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    parent.getSourceFile(),
    parent.expression,
    PUBLISH_TO_CLIENT_IDENTITY,
  );
}

/** Extract the `reason` string from `publishToClient(value, { reason: '…' })` for the audit ledger. */
function publishToClientReason(call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return '';
  const propertyLength = compilerArrayLength(
    options.properties,
    'publishToClient reason properties',
  );
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      options.properties,
      index,
      'publishToClient reason properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property)
      throw new TypeError(`publishToClient reason properties[${index}] must be dense.`);
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === PUBLISH_TO_CLIENT_REASON_PROPERTY &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return '';
}

function sourceSite(fileName: string, sourceFile: ts.SourceFile, position: number): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${fileName}:${line + 1}`;
}

function collectLocalDeclarations(root: ts.Node, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      compilerSetAdd(names, node.name.text);
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      compilerSetAdd(names, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

// A value reference (not a declaration site, property name, or import binding name). Reused from the
// scanner's own `isReferenceIdentifier` discipline: a callee identifier IS a value reference (we
// then separate callee vs non-callee by parent shape, not by excluding it here).
function isValueReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
    // `{ track }` — shorthand IS a value read of `track`.
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  return true;
}

/**
 * Run the whole-channel capture analysis over a parsed component module. Pure over `model.sourceFile`
 * so the diagnostic validator and the lowering emit gate share ONE definition of "client-safe".
 */
export function analyzeClientCaptures(model: ComponentModuleModel): ClientCaptureAnalysis {
  const sourceFile = model.sourceFile;
  const fileName = sourceFile.fileName;
  const bindings = importBindings(sourceFile);
  const constants = moduleConstantBindings(model);
  const bindingByName = compilerCreateMap<string, CaptureBinding>();
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    compilerMapSet(bindingByName, binding.localName, binding);
  }
  for (let index = 0; index < constants.length; index += 1) {
    const binding = constants[index]!;
    compilerMapSet(bindingByName, binding.localName, binding);
  }

  const allUses: CaptureUse[] = [];
  const publishFacts: PublishToClientFact[] = [];
  const bodies = handlerArrowBodies(sourceFile);
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index]!;
    classifyCaptures(body, bindingByName, fileName, allUses, publishFacts);
  }

  // An import is UNSAFE at a use iff that use is value-position (not callee) and not published.
  // Same-file serializable module constants are stricter: they are evaluated into `*.client.js`, so
  // every captured use must be explicitly publishToClient-wrapped. A bare callee-position use is
  // not a meaningful client-code channel for a literal constant and remains blocked.
  const unsafeUses: CaptureUse[] = [];
  const blockedImports: string[] = [];
  const referencedImports: string[] = [];
  const blockedConstants: string[] = [];
  const referencedConstants: string[] = [];
  for (let index = 0; index < allUses.length; index += 1) {
    const use = allUses[index]!;
    const unsafe =
      use.binding.source === 'module-constant' ? !use.published : !use.callee && !use.published;
    if (unsafe) compilerArrayAppend(unsafeUses, use, 'Unsafe client-capture uses');
    const referenced = use.binding.source === 'import' ? referencedImports : referencedConstants;
    appendUniqueName(referenced, use.binding.localName);
    if (unsafe) {
      const blocked = use.binding.source === 'import' ? blockedImports : blockedConstants;
      appendUniqueName(blocked, use.binding.localName);
    }
  }

  // Emit is allowed for a binding iff it has NO un-wrapped value-position use anywhere — callee-only
  // captures and publishToClient-wrapped captures keep their import line; everything else is withheld.
  const emitAllowed = allowedCaptureNames(referencedImports, blockedImports);
  const emitAllowedModuleConstants = allowedCaptureNames(referencedConstants, blockedConstants);

  return { emitAllowed, emitAllowedModuleConstants, publishFacts, unsafeUses };
}

function appendUniqueName(names: string[], name: string): void {
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] === name) return;
  }
  compilerArrayAppend(names, name, 'Client-capture names');
}

function allowedCaptureNames(
  referenced: readonly string[],
  blocked: readonly string[],
): Set<string> {
  const result = compilerCreateSet<string>();
  for (let index = 0; index < referenced.length; index += 1) {
    const name = referenced[index]!;
    let denied = false;
    for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex += 1) {
      if (blocked[blockedIndex] === name) {
        denied = true;
        break;
      }
    }
    if (!denied) compilerSetAdd(result, name);
  }
  return result;
}

/**
 * The set of import local names lower/handlers.ts is permitted to re-emit into `*.client.js`. Any
 * captured named import outside this set is withheld (fail-closed): the secret specifier never
 * reaches the client bundle.
 */
export function emitAllowedImportLocalNames(model: ComponentModuleModel): ReadonlySet<string> {
  return analyzeClientCaptures(model).emitAllowed;
}

/**
 * The set of same-file module constants lower/handlers.ts is permitted to inline into
 * `*.client.js`. A literal constant is emitted only when its captured use is explicitly
 * publishToClient-wrapped, matching the KV437 teaching diagnostic.
 */
export function emitAllowedModuleConstantNames(model: ComponentModuleModel): ReadonlySet<string> {
  return analyzeClientCaptures(model).emitAllowedModuleConstants;
}

/**
 * Compiler validator: emit KV437 at every un-wrapped value-position capture of a cross-module
 * import inside a client handler closure. The matching by-construction refusal (withholding the
 * specifier) happens in lower/handlers.ts via {@link emitAllowedImportLocalNames}.
 */
export function validateClientHandlerSecretCapture(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const analysis = analyzeClientCaptures(model);
  const found: CompilerDiagnostic[] = [];
  const length = compilerArrayLength(analysis.unsafeUses, 'Unsafe client-capture uses');
  for (let index = 0; index < length; index += 1) {
    const use = compilerOwnDataValue(analysis.unsafeUses, index, 'Unsafe client-capture uses') as
      | CaptureUse
      | undefined;
    if (!use) {
      throw new TypeError(`Unsafe client-capture uses[${index}] must be an own capture fact.`);
    }
    compilerArrayAppend(
      found,
      diagnostics.at(
        'KV437',
        { length: use.length, start: use.start },
        use.binding.source === 'import'
          ? `import="${use.binding.localName}" from="${use.binding.moduleSpecifier}" form=${use.binding.kind}`
          : `moduleConstant="${use.binding.localName}" scope=same-file`,
      ),
      'Client-capture diagnostics',
    );
  }
  return found;
}
