import { freezeSecurityValue } from './security-witness-intrinsics.js';

/**
 * Compiler-owned finite vocabulary for security-critical browser and server effects.
 *
 * App source never imports or constructs this IR. The compiler derives it from authored
 * TSX/JSX, generated browser modules carry only the browser subset, and framework explain/check
 * surfaces consume the server subset (SPEC §4.3, §5.2, §6.6, and §9.1).
 *
 * @internal
 */
export const securityOperationIrSchema = 'kovo-security-operation-ir/v1' as const;

/**
 * Compiler-owned normalized provenance graph layered over the finite operation IR.
 *
 * The graph is audit evidence produced by the compiler, not an app-authored program or runtime
 * opcode surface. It records only the narrow cross-helper facts that remain after capability and
 * finite-operation closure (SPEC §5.2 and §6.6).
 *
 * @internal
 */
export const securitySemanticGraphSchema = 'kovo-security-semantic-graph/v2' as const;

/** @internal Closed browser-effect inventory; C9 maps every entry to one reviewed boundary owner. */
export const browserSecurityOperationKinds = freezeSecurityValue([
  'browser.dialog.close',
  'browser.dialog.open',
  'browser.dom.focus',
  'browser.event.control',
  'browser.event.read',
  'browser.form.reset',
  'browser.form.submit',
  'browser.framework.call',
  'browser.state.read',
  'browser.state.write',
  'browser.timer.cancel',
  'browser.timer.schedule',
] as const);

/** @internal */
export type BrowserSecurityOperationKind = (typeof browserSecurityOperationKinds)[number];

/**
 * @internal Closed server-effect and compiler-control inventory. `server.handler.root` is a source
 * census record and `server.helper.call` is an exact same-file authority-transfer edge; neither is
 * a claim that a downstream runtime effect has already been summarized. C9 maps those two control
 * records to capability closure and maps every terminal effect to its reviewed boundary owner.
 */
export const serverSecurityOperationKinds = freezeSecurityValue([
  'server.authority.scope',
  'server.database.read',
  'server.database.trusted-sql',
  'server.database.write',
  'server.egress.request',
  'server.handler.root',
  'server.helper.call',
  'server.output.trusted-html',
  'server.response.cookie',
  'server.response.header',
  'server.response.outcome',
  'server.response.raw',
  'server.response.redirect',
  'server.storage.read',
  'server.storage.write',
  'server.task.compose',
] as const);

/** @internal */
export type ServerSecurityOperationKind = (typeof serverSecurityOperationKinds)[number];

/** @internal */
export type SecurityOperationKind = BrowserSecurityOperationKind | ServerSecurityOperationKind;

/** @internal Exact compiler/runtime union enrolled in the C9 proof-owner inventory. */
export const securityOperationKinds: readonly SecurityOperationKind[] = freezeSecurityValue([
  ...browserSecurityOperationKinds,
  ...serverSecurityOperationKinds,
]);

/** @internal */
export type SecurityOperationDoor =
  | 'Response'
  | 'compiler-dom-focus'
  | 'compiler-form'
  | 'compiler-state'
  | 'context.setCookie'
  | 'delegated-event'
  | 'framework-storage'
  | 'framework-timer'
  | 'handler-root'
  | 'local-call-edge'
  | 'managed-db'
  | 'platform-invoker'
  | 'principal-scope'
  | 'respond.*'
  | 'reviewed-client-export'
  | 'structured-headers'
  | 'task-context'
  | 'trustedHtml'
  | 'trustedSql'
  | 'ctx.fetch'
  | 'redirect';

/** @internal Compiler-owned operation after source scanning. */
export interface SecurityOperationIr {
  readonly door: SecurityOperationDoor;
  readonly kind: SecurityOperationKind;
  /** Source-derived handler root for a compiler-control edge; never executable authority. */
  readonly root?: string;
  /** Human-readable, source-derived target; never executable authority. */
  readonly target?: string;
  /** Required only for the three named exceptional doors. */
  readonly justification?: string;
}

/** @internal Deterministic resource ceilings for the narrow semantic interpreter. */
export interface SecuritySemanticBudgets {
  readonly callDepth: number;
  readonly nodes: number;
  readonly operations: number;
  readonly summaries: number;
}

/** @internal Every non-proved semantic path closes under one stable reason. */
export type SecuritySemanticClosedReason =
  | 'budget-call-depth'
  | 'budget-node-count'
  | 'budget-operation-count'
  | 'budget-summary-count'
  | 'helper-cycle'
  | 'opaque-transfer'
  | 'unknown-operation'
  | 'unsupported-authority-use';

/** @internal One finite reviewed operation reached through the normalized helper graph. */
export interface SecuritySemanticProvedTrace {
  readonly root: string;
  readonly sink: {
    readonly door: SecurityOperationDoor;
    readonly kind: ServerSecurityOperationKind;
    readonly target?: string;
  };
  readonly transfers: readonly string[];
  readonly verdict: 'proved';
}

/** @internal One unsupported or exhausted path and its explicit fail-closed verdict. */
export interface SecuritySemanticClosedTrace {
  readonly detail: string;
  readonly reason: SecuritySemanticClosedReason;
  readonly root: string;
  readonly sink: string;
  readonly transfers: readonly string[];
  readonly verdict: 'closed';
}

/** @internal */
export type SecuritySemanticTrace = SecuritySemanticProvedTrace | SecuritySemanticClosedTrace;

/** @internal Bottom-up result for one exact same-file callable and authority-input shape. */
export interface SecuritySemanticSummary {
  readonly authorityInputs: readonly string[];
  readonly callable: string;
  /** Exact authored declaration identity within the root's immutable source snapshot. */
  readonly callableSpan: { readonly end: number; readonly start: number };
  readonly operationKinds: readonly ServerSecurityOperationKind[];
  readonly verdict: 'closed' | 'proved';
}

/** @internal Exact authored factory/callback identity that owns one semantic root. */
export interface SecuritySemanticRootBinding {
  readonly callback: 'handler' | 'load' | 'run';
  /** Exact authored callback identity within the root's immutable source snapshot. */
  readonly callableSpan: { readonly end: number; readonly start: number };
  readonly factory: 'endpoint' | 'mutation' | 'query' | 'task' | 'webhook';
  /** Exact enrolled factory invocation within the same immutable source snapshot. */
  readonly factoryCallSpan: { readonly end: number; readonly start: number };
  readonly root: string;
}

/** @internal One exact helper call-site fact backing a bottom-up semantic summary. */
export interface SecuritySemanticHelperInvocationFact {
  /** Exact authored argument identities, in source order, for this invocation. */
  readonly argumentSpans: readonly { readonly end: number; readonly start: number }[];
  readonly authorityInputs: readonly string[];
  readonly callable: string;
  readonly callableSpan: { readonly end: number; readonly start: number };
  readonly callSpan: { readonly end: number; readonly start: number };
  readonly operationKinds: readonly ServerSecurityOperationKind[];
  /** Complete ordered root-to-helper transfer prefix for this exact invocation. */
  readonly transfers: readonly string[];
  readonly verdict: 'closed' | 'proved';
}

/** @internal Root-scoped normalized provenance facts. */
export interface SecuritySemanticRoot {
  readonly binding: SecuritySemanticRootBinding;
  readonly helperInvocations: readonly SecuritySemanticHelperInvocationFact[];
  readonly root: string;
  readonly summaries: readonly SecuritySemanticSummary[];
  readonly traces: readonly SecuritySemanticTrace[];
}

/** @internal Compiler artifact consumed by graph/explain and generated-manifest verification. */
export interface SecuritySemanticGraph {
  readonly budgets: SecuritySemanticBudgets;
  readonly roots: readonly SecuritySemanticRoot[];
  readonly schema: typeof securitySemanticGraphSchema;
}

/**
 * Exact kind/door pairing. A generated artifact cannot widen the vocabulary by spelling a new
 * operation or attaching a privileged door to an unrelated operation.
 *
 * @internal
 */
export function securityOperationDoorForKind(kind: SecurityOperationKind): SecurityOperationDoor {
  switch (kind) {
    case 'browser.state.read':
    case 'browser.state.write':
      return 'compiler-state';
    case 'browser.event.read':
    case 'browser.event.control':
      return 'delegated-event';
    case 'browser.dom.focus':
      return 'compiler-dom-focus';
    case 'browser.dialog.open':
    case 'browser.dialog.close':
      return 'platform-invoker';
    case 'browser.form.reset':
    case 'browser.form.submit':
      return 'compiler-form';
    case 'browser.framework.call':
      return 'reviewed-client-export';
    case 'browser.timer.schedule':
    case 'browser.timer.cancel':
      return 'framework-timer';
    case 'server.authority.scope':
      return 'principal-scope';
    case 'server.egress.request':
      return 'ctx.fetch';
    case 'server.helper.call':
      return 'local-call-edge';
    case 'server.handler.root':
      return 'handler-root';
    case 'server.database.read':
    case 'server.database.write':
      return 'managed-db';
    case 'server.database.trusted-sql':
      return 'trustedSql';
    case 'server.response.redirect':
      return 'redirect';
    case 'server.response.cookie':
      return 'context.setCookie';
    case 'server.response.header':
      return 'structured-headers';
    case 'server.response.outcome':
      return 'respond.*';
    case 'server.response.raw':
      return 'Response';
    case 'server.output.trusted-html':
      return 'trustedHtml';
    case 'server.task.compose':
      return 'task-context';
    case 'server.storage.read':
    case 'server.storage.write':
      return 'framework-storage';
  }
}

/** @internal */
export function isBrowserSecurityOperationKind(
  value: unknown,
): value is BrowserSecurityOperationKind {
  switch (value) {
    case 'browser.dialog.close':
    case 'browser.dialog.open':
    case 'browser.dom.focus':
    case 'browser.event.control':
    case 'browser.event.read':
    case 'browser.form.reset':
    case 'browser.form.submit':
    case 'browser.framework.call':
    case 'browser.state.read':
    case 'browser.state.write':
    case 'browser.timer.cancel':
    case 'browser.timer.schedule':
      return true;
    default:
      return false;
  }
}

/** @internal */
export function isServerSecurityOperationKind(
  value: unknown,
): value is ServerSecurityOperationKind {
  switch (value) {
    case 'server.authority.scope':
    case 'server.database.read':
    case 'server.database.trusted-sql':
    case 'server.database.write':
    case 'server.egress.request':
    case 'server.handler.root':
    case 'server.helper.call':
    case 'server.output.trusted-html':
    case 'server.response.cookie':
    case 'server.response.header':
    case 'server.response.outcome':
    case 'server.response.raw':
    case 'server.response.redirect':
    case 'server.storage.read':
    case 'server.storage.write':
    case 'server.task.compose':
      return true;
    default:
      return false;
  }
}

/** @internal */
export function securityOperationNeedsJustification(kind: SecurityOperationKind): boolean {
  return (
    kind === 'server.database.trusted-sql' ||
    kind === 'server.output.trusted-html' ||
    kind === 'server.response.raw'
  );
}
