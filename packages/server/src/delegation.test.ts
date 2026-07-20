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
    if (false) {
      // @ts-expect-error a child right must be one of the parent authority's exact right union
      void onBehalfOf(root, { actor: 'support-2', rights: ['read:other'] as const });
    }
    await expect(
      onBehalfOf(root, {
        actor: 'support-2',
        rights: ['read:other' as never],
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

  it('rejects duplicate, non-printable, and accessor-backed root authority inputs', async () => {
    const store = createMemoryPrincipalEpochStore();
    await initializePrincipalEpoch(store, 'organization-1');

    await expect(
      createDelegationAuthority({
        actor: 'admin-1',
        principal: 'organization-1',
        principalEpochStore: store,
        rights: ['read:ticket', 'read:ticket'] as const,
      }),
    ).rejects.toThrow(/duplicates/u);
    await expect(
      createDelegationAuthority({
        actor: 'admin-1',
        principal: 'organization-1',
        principalEpochStore: store,
        rights: ['read:ticket\u202eadmin'] as const,
      }),
    ).rejects.toThrow(/finite kind:resource grammar/u);

    const accessorOptions = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperties(accessorOptions, {
      actor: {
        configurable: true,
        get() {
          throw new Error('must not invoke app getter');
        },
      },
      principal: { configurable: true, value: 'organization-1' },
      principalEpochStore: { configurable: true, value: store },
      rights: { configurable: true, value: ['read:ticket'] },
    });
    await expect(
      createDelegationAuthority(
        accessorOptions as unknown as Parameters<typeof createDelegationAuthority>[0],
      ),
    ).rejects.toThrow(/stable own data/u);
  });
});
