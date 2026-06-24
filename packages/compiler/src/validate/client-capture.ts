import * as ts from 'typescript';

import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';

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

const PUBLISH_TO_CLIENT = 'publishToClient';
const CORE_MODULE = '@kovojs/core';

interface ImportBinding {
  /** Local name the handler closure can reference. */
  localName: string;
  /** Named / default / namespace — covers all laundering forms the threat model lists. */
  kind: 'named' | 'default' | 'namespace';
  importedName: string;
  /** Surface module specifier (followed only as a label; the binding itself is the resolved fact). */
  moduleSpecifier: string;
}

interface CaptureUse {
  binding: ImportBinding;
  /** True when the import is the callee of a call expression (client-safe code). */
  callee: boolean;
  /** True when this value-position use is the first arg of a recognized publishToClient(...) call. */
  published: boolean;
  start: number;
  length: number;
}

// SF-WIRE(graph-output): list publishToClient in --capabilities. These PublishToClientFacts (site +
// reason) are PRODUCED here by analyzeClientCaptures and must be threaded through the compile result
// into graph.capabilities so `kovo explain --capabilities` enumerates the audited closure-capture
// escapes (peer of the trustedReveal/accept.unverified escapes). The consuming render lives in
// packages/cli/src/graph-output.ts, which this slice intentionally does NOT edit.
/** One audited `publishToClient(import, { reason })` escape, for `kovo explain --capabilities`. */
export interface PublishToClientFact {
  localName: string;
  moduleSpecifier: string;
  reason: string;
  fileName: string;
  start?: number;
}

export interface ClientCaptureAnalysis {
  /** Un-wrapped value-position captures: each is a KV437 site. */
  unsafeUses: readonly CaptureUse[];
  /** Audited publishToClient escapes recorded for the capabilities ledger. */
  publishFacts: readonly PublishToClientFact[];
  /** Import local names whose every value-position use is callee-only or published → safe to emit. */
  emitAllowed: ReadonlySet<string>;
}

/**
 * Collect every import binding the module declares, in all three forms the laundering threat model
 * names. We follow the RESOLVED binding (the local name a handler can capture), not the surface
 * specifier, so a barrel/re-export cannot bypass the gate: re-exporting a secret through `index.ts`
 * still produces a captured local binding here.
 */
function importBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;

    if (clause.name) {
      bindings.push({
        importedName: 'default',
        kind: 'default',
        localName: clause.name.text,
        moduleSpecifier,
      });
    }

    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.push({
        importedName: '*',
        kind: 'namespace',
        localName: named.name.text,
        moduleSpecifier,
      });
    } else if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        bindings.push({
          importedName: element.propertyName?.text ?? element.name.text,
          kind: 'named',
          localName: element.name.text,
          moduleSpecifier,
        });
      }
    }
  }

  return bindings;
}

/** True when `publishToClient` is imported from @kovojs/core under that exact local name. */
function publishToClientIsBound(bindings: readonly ImportBinding[]): boolean {
  return bindings.some(
    (binding) =>
      binding.kind === 'named' &&
      binding.localName === PUBLISH_TO_CLIENT &&
      binding.importedName === PUBLISH_TO_CLIENT &&
      binding.moduleSpecifier === CORE_MODULE,
  );
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
        bodies.push(expression.body);
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
  return /^on[A-Z][A-Za-z0-9]*$/.test(name);
}

/**
 * Classify, within one handler body, every captured-import identifier as callee-position (safe),
 * publishToClient-wrapped (audited escape), or an un-wrapped value-position use (the leak).
 */
function classifyCaptures(
  body: ts.Node,
  bindingByName: ReadonlyMap<string, ImportBinding>,
  publishBound: boolean,
  fileName: string,
  uses: CaptureUse[],
  publishFacts: PublishToClientFact[],
): void {
  // Identifiers declared locally inside the handler shadow a module import of the same name; track
  // them so a local `const track = …` is never mistaken for the captured import.
  const shadowed = new Set<string>();
  collectLocalDeclarations(body, shadowed);

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
      const binding = bindingByName.get(node.text);
      if (binding && !shadowed.has(node.text)) {
        const parent = node.parent;
        const callee = ts.isCallExpression(parent) && parent.expression === node;
        const published = publishBound && isPublishToClientArgument(node, parent);
        if (published) {
          publishFacts.push({
            fileName,
            localName: binding.localName,
            moduleSpecifier: binding.moduleSpecifier,
            reason: publishToClientReason(parent as ts.CallExpression),
            start: node.getStart(),
          });
        }
        uses.push({
          binding,
          callee,
          length: node.getEnd() - node.getStart(),
          published,
          start: node.getStart(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(body);
}

/** True when `node` is the first argument of a `publishToClient(value, …)` call. */
function isPublishToClientArgument(node: ts.Identifier, parent: ts.Node): boolean {
  if (!ts.isCallExpression(parent)) return false;
  if (!ts.isIdentifier(parent.expression) || parent.expression.text !== PUBLISH_TO_CLIENT) {
    return false;
  }
  return parent.arguments[0] === node;
}

/** Extract the `reason` string from `publishToClient(value, { reason: '…' })` for the audit ledger. */
function publishToClientReason(call: ts.CallExpression): string {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return '';
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'reason' &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return '';
}

function collectLocalDeclarations(root: ts.Node, names: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.add(node.name.text);
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
  const bindingByName = new Map(bindings.map((binding) => [binding.localName, binding]));
  const publishBound = publishToClientIsBound(bindings);

  const allUses: CaptureUse[] = [];
  const publishFacts: PublishToClientFact[] = [];
  for (const body of handlerArrowBodies(sourceFile)) {
    classifyCaptures(body, bindingByName, publishBound, fileName, allUses, publishFacts);
  }

  // An import is UNSAFE at a use iff that use is value-position (not callee) and not published.
  const unsafeUses = allUses.filter((use) => !use.callee && !use.published);

  // Emit is allowed for a binding iff it has NO un-wrapped value-position use anywhere — callee-only
  // captures and publishToClient-wrapped captures keep their import line; everything else is withheld.
  const blocked = new Set(unsafeUses.map((use) => use.binding.localName));
  const referenced = new Set(allUses.map((use) => use.binding.localName));
  const emitAllowed = new Set([...referenced].filter((name) => !blocked.has(name)));

  return { emitAllowed, publishFacts, unsafeUses };
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
 * Compiler validator: emit KV437 at every un-wrapped value-position capture of a cross-module
 * import inside a client handler closure. The matching by-construction refusal (withholding the
 * specifier) happens in lower/handlers.ts via {@link emitAllowedImportLocalNames}.
 */
export function validateClientHandlerSecretCapture(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const analysis = analyzeClientCaptures(model);
  return analysis.unsafeUses.map((use) =>
    diagnostics.at(
      'KV437',
      { length: use.length, start: use.start },
      `import="${use.binding.localName}" from="${use.binding.moduleSpecifier}" form=${use.binding.kind}`,
    ),
  );
}
