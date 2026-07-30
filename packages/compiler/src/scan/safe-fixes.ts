import type * as TS from 'typescript';
import { typescriptRuntime as ts } from '../ts-api.js';

import type { DiagnosticCode } from '@kovojs/core/diagnostics';
import { assertRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';

import { canonicalJson } from '../canonical-json.js';
import { compileComponentModule } from '../compile.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerStringSlice,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import type { CompilerDiagnostic } from '../diagnostics.js';
import type { CompileComponentOptions, CompileResult, ComponentGraphFact } from '../types.js';
import { parseSourceFile } from './parse.js';

/** @internal Diagnostic codes with a closed, compiler-proven source rewrite recipe. */
export type SafeComponentFixCode = 'KV223' | 'KV232';

/** @internal One compiler-proven source edit emitted by the safe-fix planner. */
export interface SafeComponentFixEdit {
  readonly code: SafeComponentFixCode;
  /** Structural edit atoms used by the cost-to-green metric: one removed AST node is one atom. */
  readonly editAtoms: 1;
  readonly end: number;
  readonly recipe: 'remove-behavior-equivalent-override' | 'remove-derived-stamp';
  readonly start: number;
}

/** @internal Compiler proof class required before an authored rewrite may be returned. */
export type SafeComponentFixProof = 'behavior-equivalent' | 'compiler-derived-security-hardening';

interface SafeComponentFixBase {
  readonly blockedCodes: readonly DiagnosticCode[];
  readonly diagnosticsBefore: readonly CompilerDiagnostic[];
  readonly fileName: string;
}

/** @internal Fail-closed result of analyzing one authored TSX/JSX module for safe rewrites. */
export type SafeComponentFixResult =
  | (SafeComponentFixBase & {
      readonly status: 'green';
    })
  | (SafeComponentFixBase & {
      readonly reason:
        | 'ambiguous-or-unsupported-diagnostic'
        | 'emitted behavior changed after the candidate rewrite'
        | 'rewrite changed source outside the approved AST nodes'
        | 'rewrite did not make the analyzer green';
      readonly status: 'blocked';
    })
  | (SafeComponentFixBase & {
      readonly behaviorFingerprintAfter: string;
      readonly diagnosticsAfter: readonly CompilerDiagnostic[];
      readonly edits: readonly SafeComponentFixEdit[];
      readonly source: string;
      readonly status: 'fixable';
    } & (
        | {
            readonly behaviorFingerprintBefore: string;
            readonly proof: 'behavior-equivalent';
          }
        | {
            readonly behaviorFingerprintBefore: null;
            readonly proof: 'compiler-derived-security-hardening';
          }
      ));

/** @internal Input for an independent post-rewrite analyzer/emitter proof. */
export type ProveSafeComponentRewriteInput = {
  readonly edits: readonly SafeComponentFixEdit[];
  readonly fileName: string;
  readonly originalSource: string;
  readonly source: string;
  readonly targetCodes: readonly DiagnosticCode[];
} & (
  | {
      readonly expectedBehaviorFingerprint: string;
      readonly proof: 'behavior-equivalent';
    }
  | {
      readonly proof: 'compiler-derived-security-hardening';
    }
);

/** @internal Closed verdict produced by {@link proveSafeComponentRewrite}. */
export type ProveSafeComponentRewriteResult =
  | { readonly behaviorFingerprint: string; readonly diagnostics: readonly []; readonly ok: true }
  | {
      readonly diagnostics: readonly CompilerDiagnostic[];
      readonly ok: false;
      readonly reason:
        | 'analyzer-not-green'
        | 'emitted-behavior-drift'
        | 'rewrite-shape-drift'
        | 'target-diagnostic-remains';
    };

/**
 * Plan only compiler-proven source rewrites and independently re-run the compiler afterward.
 *
 * SPEC §5.2 keeps app source as TSX/JSX and makes compiler artifacts the behavioral witness. A
 * diagnostic code is not enough authority to rewrite source: the exact diagnostic must be
 * framework-constructed, its span must resolve to a closed AST-node recipe, the rewritten source
 * must be diagnostic-free, and behavior-equivalent recipes must retain the compiler's exact
 * semantic fingerprint. KV223 is different: app-authored lowered IR is already rejected and can
 * suppress compiler-owned escaping, so its closed data-bind recipe proves a compiler-derived
 * security hardening rather than pretending the invalid input had accepted runtime behavior.
 * Ambiguity closes without returning candidate source.
 *
 * @internal Used by the `kovo fix` command; not an app-author API.
 */
export function analyzeSafeComponentFixes(
  options: Pick<CompileComponentOptions, 'fileName' | 'source'>,
): SafeComponentFixResult {
  const before = compileComponentModule(options);
  assertDiagnostics(before.diagnostics, 'Safe-fix input diagnostics');
  if (compilerArrayLength(before.diagnostics, 'Safe-fix input diagnostics') === 0) {
    return {
      blockedCodes: [],
      diagnosticsBefore: before.diagnostics,
      fileName: options.fileName,
      status: 'green',
    };
  }

  const sourceFile = parseSourceFile(options.fileName, options.source);
  const nodes = sourceNodes(sourceFile);
  const edits: SafeComponentFixEdit[] = [];
  const blockedCodes: DiagnosticCode[] = [];

  const diagnosticCount = compilerArrayLength(before.diagnostics, 'Safe-fix input diagnostics');
  for (let index = 0; index < diagnosticCount; index += 1) {
    const diagnostic = before.diagnostics[index]!;
    const edit = editForDiagnostic(sourceFile, nodes, diagnostic);
    if (edit === undefined) {
      // A redundant authored runtime stamp currently emits both the focused teaching lint KV223
      // and the broader generated-control-plane guard KV235 at the exact same span. The KV235 is
      // discharged only as a co-located consequence of the KV223 typed-node recipe; a standalone
      // KV235 remains unsupported and closes below.
      if (
        diagnostic.code === 'KV235' &&
        hasCoLocatedDiagnostic(before.diagnostics, diagnostic, 'KV223')
      ) {
        continue;
      }
      appendUniqueCode(blockedCodes, diagnostic.code);
      continue;
    }
    appendEdit(edits, edit);
  }

  if (blockedCodes.length > 0 || edits.length === 0 || editsOverlap(edits)) {
    return {
      blockedCodes,
      diagnosticsBefore: before.diagnostics,
      fileName: options.fileName,
      reason: 'ambiguous-or-unsupported-diagnostic',
      status: 'blocked',
    };
  }

  const rewriteProof = proofForEdits(edits);
  if (rewriteProof === undefined) {
    return {
      blockedCodes: targetCodes(edits),
      diagnosticsBefore: before.diagnostics,
      fileName: options.fileName,
      reason: 'ambiguous-or-unsupported-diagnostic',
      status: 'blocked',
    };
  }

  const rewrittenSource = applyEdits(options.source, edits);
  const rewrittenCodes = targetCodes(edits);
  if (rewriteProof === 'behavior-equivalent') {
    const behaviorFingerprintBefore = compileBehaviorFingerprint(before);
    const proof = proveSafeComponentRewrite({
      edits,
      expectedBehaviorFingerprint: behaviorFingerprintBefore,
      fileName: options.fileName,
      originalSource: options.source,
      proof: rewriteProof,
      source: rewrittenSource,
      targetCodes: rewrittenCodes,
    });
    if (!proof.ok) {
      return blockedProofResult(before, options.fileName, rewrittenCodes, proof.reason);
    }
    return {
      behaviorFingerprintAfter: proof.behaviorFingerprint,
      behaviorFingerprintBefore,
      blockedCodes: [],
      diagnosticsAfter: proof.diagnostics,
      diagnosticsBefore: before.diagnostics,
      edits,
      fileName: options.fileName,
      proof: rewriteProof,
      source: rewrittenSource,
      status: 'fixable',
    };
  }

  const proof = proveSafeComponentRewrite({
    edits,
    fileName: options.fileName,
    originalSource: options.source,
    proof: rewriteProof,
    source: rewrittenSource,
    targetCodes: rewrittenCodes,
  });
  if (!proof.ok) {
    return blockedProofResult(before, options.fileName, rewrittenCodes, proof.reason);
  }
  return {
    behaviorFingerprintAfter: proof.behaviorFingerprint,
    behaviorFingerprintBefore: null,
    blockedCodes: [],
    diagnosticsAfter: proof.diagnostics,
    diagnosticsBefore: before.diagnostics,
    edits,
    fileName: options.fileName,
    proof: rewriteProof,
    source: rewrittenSource,
    status: 'fixable',
  };
}

function blockedProofResult(
  before: CompileResult,
  fileName: string,
  blockedCodes: readonly DiagnosticCode[],
  reason: Exclude<ProveSafeComponentRewriteResult, { readonly ok: true }>['reason'],
): SafeComponentFixResult {
  return {
    blockedCodes,
    diagnosticsBefore: before.diagnostics,
    fileName,
    reason:
      reason === 'emitted-behavior-drift'
        ? 'emitted behavior changed after the candidate rewrite'
        : reason === 'rewrite-shape-drift'
          ? 'rewrite changed source outside the approved AST nodes'
          : 'rewrite did not make the analyzer green',
    status: 'blocked',
  };
}

function hasCoLocatedDiagnostic(
  diagnostics: readonly CompilerDiagnostic[],
  diagnostic: CompilerDiagnostic,
  code: DiagnosticCode,
): boolean {
  for (let index = 0; index < diagnostics.length; index += 1) {
    const candidate = diagnostics[index]!;
    if (
      candidate.code === code &&
      candidate.length === diagnostic.length &&
      candidate.start?.line === diagnostic.start?.line &&
      candidate.start?.column === diagnostic.start?.column
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Re-run the genuine compiler after a candidate edit and require a diagnostic-free output. Recipes
 * over accepted behavior additionally require an exact semantic fingerprint; the KV223 hardening
 * recipe instead binds safety to the genuine compiler's closed redundancy diagnostic and typed AST
 * deletion because the rejected input has no framework-approved runtime behavior to preserve.
 * This separate pass is intentionally reusable by C13 mutation controls.
 *
 * @internal Security proof helper for `kovo fix`.
 */
export function proveSafeComponentRewrite(
  input: ProveSafeComponentRewriteInput,
): ProveSafeComponentRewriteResult {
  const result = compileComponentModule({ fileName: input.fileName, source: input.source });
  assertDiagnostics(result.diagnostics, 'Safe-fix proof diagnostics');
  const diagnosticCount = compilerArrayLength(result.diagnostics, 'Safe-fix proof diagnostics');
  for (let diagnosticIndex = 0; diagnosticIndex < diagnosticCount; diagnosticIndex += 1) {
    const diagnostic = result.diagnostics[diagnosticIndex]!;
    for (let codeIndex = 0; codeIndex < input.targetCodes.length; codeIndex += 1) {
      if (diagnostic.code === input.targetCodes[codeIndex]) {
        return {
          diagnostics: result.diagnostics,
          ok: false,
          reason: 'target-diagnostic-remains',
        };
      }
    }
  }
  if (diagnosticCount > 0) {
    return { diagnostics: result.diagnostics, ok: false, reason: 'analyzer-not-green' };
  }
  const behaviorFingerprint = compileBehaviorFingerprint(result);
  if (
    input.proof === 'behavior-equivalent' &&
    behaviorFingerprint !== input.expectedBehaviorFingerprint
  ) {
    return { diagnostics: result.diagnostics, ok: false, reason: 'emitted-behavior-drift' };
  }
  if (!sourceRewriteMatches(input.fileName, input.originalSource, input.source, input.edits)) {
    return { diagnostics: result.diagnostics, ok: false, reason: 'rewrite-shape-drift' };
  }
  return { behaviorFingerprint, diagnostics: [], ok: true };
}

/**
 * Stable semantic fingerprint used to bind safe source rewrites to compiler-observed behavior.
 * Diagnostic text, source spans, raw emitted formatting, and HMR's diagnostic-inclusive factHash
 * are deliberately excluded; every runtime/security fact and the semantic render hashes remain.
 *
 * @internal Exported for focused proof tests only.
 */
export function compileBehaviorFingerprint(result: CompileResult): string {
  const hmr = result.hmrImpact;
  return canonicalJson({
    agentGraphFacts: result.agentGraphFacts,
    browserPostureManifest: result.browserPostureManifest,
    clientExports: result.clientExports,
    clientModuleImportManifest: result.clientModuleImportManifest,
    componentGraphFacts: withoutComponentGraphSourceLocations(result.componentGraphFacts),
    cssAssets: result.cssAssets,
    endpointGraphFacts: result.endpointGraphFacts,
    handlerExports: result.handlerExports,
    handlerWriteSinkFacts: result.handlerWriteSinkFacts,
    hmr:
      hmr === null
        ? null
        : {
            clientHref: hmr.clientHref,
            component: hmr.component,
            liveTargetFactsHash: hmr.liveTargetFactsHash,
            queryUpdatePlanHash: hmr.queryUpdatePlanHash,
            renderOutputHash: hmr.renderOutputHash,
            stylesheetAssetsHash: hmr.stylesheetAssetsHash,
          },
    outputContextFacts: result.outputContextFacts,
    platformSubstitutions: result.platformSubstitutions,
    publishToClientFacts: withoutSourceLocations(result.publishToClientFacts),
    queryUpdatePlans: result.queryUpdatePlans,
    renderPlanFingerprint: result.renderPlanFingerprint,
    taskGraphFacts: result.taskGraphFacts,
    viewTransitions: result.viewTransitions,
  });
}

function editForDiagnostic(
  sourceFile: TS.SourceFile,
  nodes: readonly TS.Node[],
  diagnostic: CompilerDiagnostic,
): SafeComponentFixEdit | undefined {
  if (diagnostic.code !== 'KV223' && diagnostic.code !== 'KV232') return undefined;
  if (diagnostic.start === undefined || diagnostic.length === undefined || diagnostic.length < 1) {
    return undefined;
  }
  const start = diagnosticStartOffset(sourceFile, diagnostic);
  if (start === undefined) return undefined;
  const end = start + diagnostic.length;
  if (end > sourceFile.end) return undefined;
  const node = exactNodeAtSpan(sourceFile, nodes, start, end);
  if (node === undefined) return undefined;

  if (diagnostic.code === 'KV223') {
    if (ts.isJsxAttribute(node)) {
      const name = jsxAttributeName(node.name);
      if (name !== 'data-bind') return undefined;
      return { code: 'KV223', editAtoms: 1, end, recipe: 'remove-derived-stamp', start };
    }
    return undefined;
  }

  if (!ts.isJsxAttribute(node)) return undefined;
  const name = jsxAttributeName(node.name);
  if (name !== 'role' && name !== 'data-state' && !compilerStringStartsWith(name, 'aria-')) {
    return undefined;
  }
  return {
    code: 'KV232',
    editAtoms: 1,
    end,
    recipe: 'remove-behavior-equivalent-override',
    start,
  };
}

function diagnosticStartOffset(
  sourceFile: TS.SourceFile,
  diagnostic: CompilerDiagnostic,
): number | undefined {
  if (diagnostic.start === undefined) return undefined;
  const lineIndex = diagnostic.start.line - 1;
  const columnIndex = diagnostic.start.column - 1;
  const lineStarts = sourceFile.getLineStarts();
  if (lineIndex < 0 || columnIndex < 0 || lineIndex >= lineStarts.length) return undefined;
  const lineStart = lineStarts[lineIndex]!;
  const lineEnd = lineStarts[lineIndex + 1] ?? sourceFile.end;
  if (lineStart + columnIndex > lineEnd) return undefined;
  return lineStart + columnIndex;
}

function sourceNodes(sourceFile: TS.SourceFile): TS.Node[] {
  const nodes: TS.Node[] = [];
  const visit = (node: TS.Node): void => {
    compilerArrayAppend(nodes, node, 'Safe-fix source nodes');
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
}

function exactNodeAtSpan(
  sourceFile: TS.SourceFile,
  nodes: readonly TS.Node[],
  start: number,
  end: number,
): TS.Node | undefined {
  let fallback: TS.Node | undefined;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.getStart(sourceFile, false) !== start || node.end !== end) continue;
    if (ts.isJsxAttribute(node)) return node;
    fallback ??= node;
  }
  return fallback;
}

function jsxAttributeName(name: TS.JsxAttributeName): string {
  return ts.isIdentifier(name) ? name.text : `${name.namespace.text}:${name.name.text}`;
}

function appendEdit(edits: SafeComponentFixEdit[], edit: SafeComponentFixEdit): void {
  for (let index = 0; index < edits.length; index += 1) {
    const existing = edits[index]!;
    if (existing.start === edit.start && existing.end === edit.end) return;
  }
  compilerArrayAppend(edits, edit, 'Safe-fix edits');
}

function appendUniqueCode(codes: DiagnosticCode[], code: DiagnosticCode): void {
  for (let index = 0; index < codes.length; index += 1) {
    if (codes[index] === code) return;
  }
  compilerArrayAppend(codes, code, 'Safe-fix blocked codes');
}

function editsOverlap(edits: readonly SafeComponentFixEdit[]): boolean {
  for (let leftIndex = 0; leftIndex < edits.length; leftIndex += 1) {
    const left = edits[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < edits.length; rightIndex += 1) {
      const right = edits[rightIndex]!;
      if (left.start < right.end && right.start < left.end) return true;
    }
  }
  return false;
}

function applyEdits(source: string, edits: readonly SafeComponentFixEdit[]): string {
  const remaining: SafeComponentFixEdit[] = [];
  for (let index = 0; index < edits.length; index += 1) {
    compilerArrayAppend(remaining, edits[index]!, 'Safe-fix ordered edits');
  }
  for (let index = 1; index < remaining.length; index += 1) {
    const value = remaining[index]!;
    let insertion = index;
    while (insertion > 0 && remaining[insertion - 1]!.start < value.start) {
      remaining[insertion] = remaining[insertion - 1]!;
      insertion -= 1;
    }
    remaining[insertion] = value;
  }
  let rewritten = source;
  for (let index = 0; index < remaining.length; index += 1) {
    const edit = remaining[index]!;
    rewritten =
      compilerStringSlice(rewritten, 0, edit.start) + compilerStringSlice(rewritten, edit.end);
  }
  return rewritten;
}

function sourceRewriteMatches(
  fileName: string,
  originalSource: string,
  rewrittenSource: string,
  edits: readonly SafeComponentFixEdit[],
): boolean {
  const sourceFile = parseSourceFile(fileName, originalSource);
  const nodes = sourceNodes(sourceFile);
  const ordered: SafeComponentFixEdit[] = [];
  for (let editIndex = 0; editIndex < edits.length; editIndex += 1) {
    const edit = edits[editIndex]!;
    const node = exactNodeAtSpan(sourceFile, nodes, edit.start, edit.end);
    if (node === undefined || !ts.isJsxAttribute(node) || !editMatchesNode(edit, node))
      return false;
    compilerArrayAppend(ordered, edit, 'Safe-fix proof edits');
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const value = ordered[index]!;
    let insertion = index;
    while (insertion > 0 && ordered[insertion - 1]!.start > value.start) {
      ordered[insertion] = ordered[insertion - 1]!;
      insertion -= 1;
    }
    ordered[insertion] = value;
  }

  let originalCursor = 0;
  let rewrittenCursor = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index]!;
    if (edit.start < originalCursor || edit.end < edit.start) return false;
    const unchangedLength = edit.start - originalCursor;
    if (
      compilerStringSlice(originalSource, originalCursor, edit.start) !==
      compilerStringSlice(rewrittenSource, rewrittenCursor, rewrittenCursor + unchangedLength)
    ) {
      return false;
    }
    originalCursor = edit.end;
    rewrittenCursor += unchangedLength;
  }
  return (
    compilerStringSlice(originalSource, originalCursor) ===
    compilerStringSlice(rewrittenSource, rewrittenCursor)
  );
}

function editMatchesNode(edit: SafeComponentFixEdit, node: TS.JsxAttribute): boolean {
  const name = jsxAttributeName(node.name);
  if (edit.code === 'KV223') {
    return edit.recipe === 'remove-derived-stamp' && name === 'data-bind';
  }
  return (
    edit.recipe === 'remove-behavior-equivalent-override' &&
    (name === 'role' || name === 'data-state' || compilerStringStartsWith(name, 'aria-'))
  );
}

function targetCodes(edits: readonly SafeComponentFixEdit[]): SafeComponentFixCode[] {
  const codes: SafeComponentFixCode[] = [];
  for (let index = 0; index < edits.length; index += 1) appendUniqueCode(codes, edits[index]!.code);
  return codes;
}

function proofForEdits(edits: readonly SafeComponentFixEdit[]): SafeComponentFixProof | undefined {
  let proof: SafeComponentFixProof | undefined;
  for (let index = 0; index < edits.length; index += 1) {
    const candidate: SafeComponentFixProof =
      edits[index]!.code === 'KV232'
        ? 'behavior-equivalent'
        : 'compiler-derived-security-hardening';
    if (proof !== undefined && proof !== candidate) return undefined;
    proof = candidate;
  }
  return proof;
}

function assertDiagnostics(diagnostics: readonly CompilerDiagnostic[], label: string): void {
  const length = compilerArrayLength(diagnostics, label);
  for (let index = 0; index < length; index += 1) {
    assertRegisteredDiagnostic(diagnostics[index], `${label}[${index}]`);
  }
}

function withoutSourceLocations<Value extends { readonly site?: string; readonly start?: number }>(
  values: readonly Value[],
): readonly Omit<Value, 'site' | 'start'>[] {
  const result: Omit<Value, 'site' | 'start'>[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const { site: _site, start: _start, ...value } = values[index]!;
    compilerArrayAppend(result, value, 'Safe-fix location-free facts');
  }
  return result;
}

function withoutComponentGraphSourceLocations(
  values: readonly ComponentGraphFact[],
): readonly Omit<ComponentGraphFact, 'source'>[] {
  const result: Omit<ComponentGraphFact, 'source'>[] = [];
  for (let index = 0; index < values.length; index += 1) {
    // SPEC §5.2: source anchors explain authored provenance, but byte offsets are not emitted
    // behavior. Removing one approved JSX attribute may shift this span without changing any
    // runtime, graph, security, or render fact.
    const { source: _source, ...value } = values[index]!;
    compilerArrayAppend(result, value, 'Safe-fix location-free component graph facts');
  }
  return result;
}
