import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  advancePrincipalEpoch,
  createDelegationAuthority,
  createMemoryPrincipalEpochStore,
  initializePrincipalEpoch,
  onBehalfOf,
  PrincipalEpochStaleError,
  type DelegationAuthority,
} from './index.js';

describe('attenuating onBehalfOf authority (Plan 3 §3.2 C13 anchor)', () => {
  it('yields only a typed and runtime-checked subset while carrying the principal epoch', async () => {
    const store = createMemoryPrincipalEpochStore();
    await initializePrincipalEpoch(store, 'organization-1');
    const root = await createDelegationAuthority({
      actor: 'admin-1',
      principal: 'organization-1',
      principalEpochStore: store,
      rights: ['read:ticket', 'write:ticket', 'delegate:ticket'] as const,
    });
    const delegated = await onBehalfOf(root, {
      actor: 'support-1',
      rights: ['read:ticket'] as const,
    });

    expect(delegated).toMatchObject({
      actor: 'support-1',
      onBehalfOf: 'organization-1',
      principalEpoch: 1,
      rights: ['read:ticket'],
    });
    expectTypeOf(delegated).toMatchTypeOf<DelegationAuthority<'read:ticket'>>();
    // @ts-expect-error a child right must be one of the parent authority's exact right union
    void onBehalfOf(root, { actor: 'support-2', rights: ['admin:ticket'] as const });
    await expect(
      onBehalfOf(root, {
        actor: 'support-2',
        rights: ['admin:ticket' as never],
      }),
    ).rejects.toThrow(/subset/u);
  });

  it('rejects structural forgeries and propagates principal-epoch revocation', async () => {
    const store = createMemoryPrincipalEpochStore();
    await initializePrincipalEpoch(store, 'organization-1');
    await expect(
      onBehalfOf(
        {
          actor: 'admin-1',
          onBehalfOf: 'organization-1',
          principalEpoch: 1,
          rights: ['read:ticket'],
        } as DelegationAuthority<'read:ticket'>,
        { actor: 'support-1', rights: ['read:ticket'] },
      ),
    ).rejects.toThrow(/framework-owned delegation authority/u);

    const root = await createDelegationAuthority({
      actor: 'admin-1',
      principal: 'organization-1',
      principalEpochStore: store,
      rights: ['read:ticket'] as const,
    });
    await advancePrincipalEpoch(store, 'organization-1', 'role-change');
    await expect(
      onBehalfOf(root, { actor: 'support-1', rights: ['read:ticket'] }),
    ).rejects.toBeInstanceOf(PrincipalEpochStaleError);
  });
});
