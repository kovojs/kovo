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
