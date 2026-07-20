/**
 * Package-private transport from core-owned decision chokes to the server's single
 * `securityEvent()` journal. It deliberately owns no journal, buffering, or export API.
 * Generated production registration installs the bridge before app evaluation; direct
 * low-level core calls made before that registration are outside the completeness claim.
 */

/** @internal */
export type CoreSecurityDecisionDoor = 'declassification' | 'storage';

/** @internal */
export type CoreSecurityDecisionPrincipal =
  | { readonly epoch: null; readonly id: null; readonly kind: 'anonymous'; readonly tenant: null }
  | {
      readonly epoch: null;
      readonly id: string;
      readonly kind: 'system';
      readonly tenant: string | null;
    }
  | {
      readonly epoch: null;
      readonly id: string | null;
      readonly kind: 'unresolved';
      readonly reason:
        | 'epoch-unavailable'
        | 'outside-request-context'
        | 'principal-not-proven'
        | 'tenant-unavailable';
      readonly tenant: string | null;
    };

/** @internal */
export interface CoreSecurityDecisionEvent {
  readonly decisionSite: `framework:${CoreSecurityDecisionDoor}:${string}`;
  readonly door: CoreSecurityDecisionDoor;
  readonly outcome: 'allow' | 'deny';
  readonly principal: CoreSecurityDecisionPrincipal;
  readonly resourceScope: {
    readonly identity: 'global' | `sha256:${string}`;
    readonly kind: 'object' | 'secret';
  };
  readonly type: 'security-decision';
}

/** @internal */
export type CoreSecurityDecisionBridge = (event: CoreSecurityDecisionEvent) => void;

let installedBridge: CoreSecurityDecisionBridge | undefined;

/** @internal Installed exactly once by the generated server runtime before app evaluation. */
export function installCoreSecurityDecisionBridge(bridge: CoreSecurityDecisionBridge): void {
  if (installedBridge !== undefined && installedBridge !== bridge) {
    throw new TypeError('Core security-decision bridge is already installed for this boot.');
  }
  installedBridge = bridge;
}

/** Core-only emission side of the transport; intentionally not re-exported from a package path. */
export function emitCoreSecurityDecision(event: CoreSecurityDecisionEvent): void {
  installedBridge?.(event);
}
