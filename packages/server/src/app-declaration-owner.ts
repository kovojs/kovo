import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

export type AppDeclarationKind = 'endpoint' | 'layout' | 'mutation' | 'query' | 'route' | 'task';

export interface AppDeclarationOwnership {
  readonly contract: object;
  /** Stable logical identity retained when compiler-owned key assignment reconstructs a handle. */
  readonly declaration: object;
  readonly kind: AppDeclarationKind;
}

const declarationOwners = createWitnessWeakMap<object, AppDeclarationOwnership>();
const declarationMetadata = createWitnessWeakMap<object, unknown>();

/** @internal Bind an exact declaration handle to the contract receiver that minted it. */
export function registerAppDeclarationOwner<Declaration extends object>(
  declaration: Declaration,
  ownership: Omit<AppDeclarationOwnership, 'declaration'> & {
    readonly declaration?: object;
  },
): Declaration {
  const existing = witnessWeakMapGet(declarationOwners, declaration);
  if (existing !== undefined) {
    if (existing.contract !== ownership.contract || existing.kind !== ownership.kind) {
      throw new TypeError(
        'KOVO_APP_OWNER_MISMATCH: a declaration handle cannot belong to two app contracts.',
      );
    }
    return declaration;
  }
  witnessWeakMapSet(
    declarationOwners,
    declaration,
    witnessFreeze({
      contract: ownership.contract,
      declaration: ownership.declaration ?? declaration,
      kind: ownership.kind,
    }),
  );
  return declaration;
}

/** @internal Preserve app ownership across compiler-owned derived-key reconstruction. */
export function transferAppDeclarationOwner<Declaration extends object>(
  source: object,
  target: Declaration,
): Declaration {
  const ownership = witnessWeakMapGet(declarationOwners, source);
  if (ownership !== undefined) registerAppDeclarationOwner(target, ownership);
  const metadata = witnessWeakMapGet(declarationMetadata, source);
  if (metadata !== undefined) witnessWeakMapSet(declarationMetadata, target, metadata);
  return target;
}

/** @internal Resolve exact private ownership for assembly checks. */
export function appDeclarationOwner(declaration: object): AppDeclarationOwnership | undefined {
  return witnessWeakMapGet(declarationOwners, declaration);
}

/** @internal Attach framework-private app-contract metadata to a declaration handle. */
export function registerAppDeclarationMetadata(declaration: object, metadata: unknown): void {
  witnessWeakMapSet(declarationMetadata, declaration, metadata);
}

/** @internal Resolve framework-private app-contract metadata after derived-key transfer. */
export function appDeclarationMetadata(declaration: object): unknown {
  return witnessWeakMapGet(declarationMetadata, declaration);
}
