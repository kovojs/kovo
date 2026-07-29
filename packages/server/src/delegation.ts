import { isProvenPrincipal } from './auth-principal.js';
import {
  assertPrincipalEpochFresh,
  currentPrincipalEpoch,
  snapshotPrincipalEpochStore,
  type PrincipalEpochStore,
} from './principal-epoch.js';
import {
  createWitnessSet,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessNumberIsSafeInteger,
  witnessObjectIs,
  witnessRegExpTest,
  witnessSetAdd,
  witnessSetHas,
  witnessString,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

declare const delegationAuthorityBrand: unique symbol;

/** Right kinds admitted by the finite grant model (SPEC §10.3). */
export type DelegationRightKind =
  | 'delegate'
  | 'delegated-owner'
  | 'owner'
  | 'policy'
  | 'read'
  | 'write';

/** A right names both its finite kind and exact compiler-derived resource vocabulary. */
export type DelegationRight<Resource extends string = string> =
  `${DelegationRightKind}:${Resource}`;

/**
 * Immutable, framework-receipted attenuating authority (SPEC §10.3).
 *
 * The public fields are explainable evidence, not the runtime proof. Runtime consumers verify the
 * module-private receipt and current principal epoch; structural casts do not mint authority.
 */
export interface DelegationAuthority<Right extends DelegationRight = DelegationRight> {
  readonly [delegationAuthorityBrand]: {
    readonly scope: 'framework-owned-delegation-authority';
  };
  readonly actor: string;
  readonly onBehalfOf: string;
  readonly principalEpoch: number;
  readonly rights: readonly Right[];
}

/** Options for the root bridge from already-proven guard/RLS authority into delegation. */
export interface CreateDelegationAuthorityOptions<
  Rights extends readonly DelegationRight[] = readonly DelegationRight[],
> {
  /** Exact currently acting principal. This constructor does not itself prove an app policy. */
  readonly actor: string;
  /** Revocation identity whose persistent epoch binds every descendant. */
  readonly principal: string;
  readonly principalEpochStore: PrincipalEpochStore;
  /** Rights already established by the caller's guard/RLS door. */
  readonly rights: Rights;
}

/** Options for one strict-subset-or-equal delegation step. */
export interface OnBehalfOfOptions<Rights extends readonly DelegationRight[]> {
  readonly actor: string;
  readonly rights: Rights;
}

interface DelegationReceipt {
  readonly principal: string;
  readonly principalEpoch: number;
  readonly rights: ReadonlySet<DelegationRight>;
  readonly store: PrincipalEpochStore;
}

const receipts = createWitnessWeakMap<object, DelegationReceipt>();
const MAX_DELEGATION_RIGHT_LENGTH = 2_048;
const delegationRightPattern =
  /^(?:delegate|delegated-owner|owner|policy|read|write):[^\p{C}\s]+$/u;

/**
 * Bridge a guard/RLS-authorized root into the attenuating delegation algebra (SPEC §10.3).
 *
 * This constructor never grants database authority: it records the exact right set a caller says
 * its existing policy established. Widening grant-table writes remain named, budgeted escapes in
 * `kovo explain grants`; downstream engine policy remains the enforcement boundary.
 */
export async function createDelegationAuthority<const Rights extends readonly DelegationRight[]>(
  options: CreateDelegationAuthorityOptions<Rights>,
): Promise<DelegationAuthority<Rights[number]>> {
  const actor = requiredPrincipal(options, 'actor');
  const principal = requiredPrincipal(options, 'principal');
  const rights = snapshotRights(options, 'rights');
  const store = snapshotPrincipalEpochStore(requiredOwnData(options, 'principalEpochStore'));
  const state = await currentPrincipalEpoch(store, principal);
  if (state.status !== 'active') {
    // currentPrincipalEpoch validates shape, while the shared fresh assertion owns the stale class.
    await assertPrincipalEpochFresh(store, principal, state.epoch);
  }
  return mintDelegationAuthority(actor, principal, state.epoch, rights, store);
}

/**
 * Delegate a subset of an existing authority and re-witness its persistent principal epoch.
 *
 * Both TypeScript and the runtime subset test reject widened child sets. The authoritative epoch
 * lookup has no positive cache, so role/tenant/admin revocation invalidates the complete chain.
 */
export async function onBehalfOf<
  ParentRight extends DelegationRight,
  const Rights extends readonly ParentRight[],
>(
  parent: DelegationAuthority<ParentRight>,
  options: OnBehalfOfOptions<Rights>,
): Promise<DelegationAuthority<Rights[number]>> {
  if ((typeof parent !== 'object' && typeof parent !== 'function') || parent === null) {
    throw new TypeError('onBehalfOf requires a framework-owned delegation authority.');
  }
  const receipt = witnessWeakMapGet(receipts, parent);
  if (receipt === undefined) {
    throw new TypeError('onBehalfOf requires a framework-owned delegation authority.');
  }
  const actor = requiredPrincipal(options, 'actor');
  const rights = snapshotRights(options, 'rights');
  for (let index = 0; index < rights.length; index += 1) {
    if (!witnessSetHas(receipt.rights, rights[index]!)) {
      throw new TypeError('onBehalfOf rights must be a runtime subset of the parent authority.');
    }
  }
  await assertPrincipalEpochFresh(receipt.store, receipt.principal, receipt.principalEpoch);
  return mintDelegationAuthority(
    actor,
    receipt.principal,
    receipt.principalEpoch,
    rights,
    receipt.store,
  ) as DelegationAuthority<Rights[number]>;
}

function mintDelegationAuthority<Right extends DelegationRight>(
  actor: string,
  principal: string,
  principalEpoch: number,
  rights: readonly Right[],
  store: PrincipalEpochStore,
): DelegationAuthority<Right> {
  const authority = witnessFreeze({
    actor,
    onBehalfOf: principal,
    principalEpoch,
    rights,
  }) as DelegationAuthority<Right>;
  const rightSet = createWitnessSet<DelegationRight>();
  for (let index = 0; index < rights.length; index += 1) {
    witnessSetAdd(rightSet, rights[index]!);
  }
  witnessWeakMapSet(
    receipts,
    authority,
    witnessFreeze({
      principal,
      principalEpoch,
      rights: rightSet,
      store,
    }),
  );
  return authority;
}

function snapshotRights<Right extends DelegationRight>(
  options: object,
  property: PropertyKey,
): readonly Right[] {
  const source = requiredOwnData(options, property);
  if (!witnessIsArray(source)) {
    throw new TypeError('Delegation rights must be a dense array.');
  }
  const length = requiredOwnData(source, 'length');
  if (!witnessNumberIsSafeInteger(length) || length < 1 || length > 256) {
    throw new TypeError('Delegation rights require between 1 and 256 entries.');
  }
  const rights: Right[] = [];
  const seen = createWitnessSet<string>();
  for (let index = 0; index < (length as number); index += 1) {
    const right = requiredOwnData(source, index);
    if (
      typeof right !== 'string' ||
      right.length > MAX_DELEGATION_RIGHT_LENGTH ||
      !witnessRegExpTest(delegationRightPattern, right)
    ) {
      throw new TypeError('Delegation rights must use the finite kind:resource grammar.');
    }
    if (witnessSetHas(seen, right)) {
      throw new TypeError('Delegation rights must not contain duplicates.');
    }
    witnessSetAdd(seen, right);
    witnessArrayAppend(rights, right as Right, 'Delegation rights');
  }
  return witnessFreeze(rights);
}

function requiredPrincipal(source: object, property: 'actor' | 'principal'): string {
  const value = requiredOwnData(source, property);
  if (!isProvenPrincipal(value) || value.length > 1_024) {
    throw new TypeError(`Delegation ${property} must be a proven bounded principal.`);
  }
  return value;
}

function requiredOwnData(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`Delegation ${witnessString(property)} must be stable own data.`);
  }
  return before.value;
}
