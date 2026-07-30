import { describe, expect, it, vi } from 'vitest';

import { loadCompiledOptimisticSubmission } from './compiled-optimism.js';
import { guardKovoDynamicImportModule } from './dynamic-import-url.js';
import {
  canonicalInstanceKeyValue,
  optimisticChangeFromInput,
  resolveOptimisticTargets,
} from './optimism.js';

const moduleHref = `/c/__v/${'a'.repeat(64)}/src/mutations.client.js`;

describe('compiler-emitted optimistic plans', () => {
  it('validates the authenticated module, decodes FormData, and resolves every keyed instance', async () => {
    const predict = vi.fn((value: { count: number }, input: { quantity: number }) => ({
      count: value.count + input.quantity,
    }));
    const deriveKeys = vi.fn((input: { first: string; second: string }) => [
      `product:${canonicalInstanceKeyValue({ id: input.first, org: 'acme' }, ['org', 'id'])}`,
      `product:${canonicalInstanceKeyValue({ id: input.second, org: 'acme' }, ['org', 'id'])}`,
    ]);
    const importModule = guardKovoDynamicImportModule(
      vi.fn(async () => ({
        kovoOptimisticMutationPlans: {
          'cart/add': {
            inputFields: [
              {
                coercion: 'string',
                defaulted: false,
                name: 'first',
                optional: false,
                required: true,
              },
              {
                coercion: 'string',
                defaulted: false,
                name: 'second',
                optional: false,
                required: true,
              },
              {
                coercion: 'number',
                defaulted: false,
                name: 'quantity',
                optional: false,
                required: true,
              },
              {
                coercion: 'boolean',
                defaulted: false,
                name: 'featured',
                optional: true,
                required: false,
              },
            ],
            invalidations: ['cart', 'product'],
            keys: { product: deriveKeys },
            mutation: 'cart/add',
            queue: 'cart',
            schema: 'kovo.optimistic-plan/v2',
            statuses: { cart: 'hand-written', product: 'hand-written' },
            transforms: { cart: predict, product: predict },
          },
        },
      })),
      { allowedModuleUrls: [moduleHref] },
    );
    const formData = new FormData();
    formData.set('first', 'p1');
    formData.set('second', 'p2');
    formData.set('quantity', '2');
    formData.set('featured', 'on');

    const submission = await loadCompiledOptimisticSubmission({
      formData,
      importModule,
      moduleHref,
      mutation: 'cart/add',
    });

    expect(submission.input).toEqual({
      featured: true,
      first: 'p1',
      quantity: 2,
      second: 'p2',
    });
    expect(submission.optimistic.queue).toBe('cart');
    expect(
      resolveOptimisticTargets(submission.optimistic, optimisticChangeFromInput(submission.input)),
    ).toEqual([
      { queryName: 'cart' },
      {
        key: `product:${canonicalInstanceKeyValue({ id: 'p1', org: 'acme' }, ['org', 'id'])}`,
        queryName: 'product',
      },
      {
        key: `product:${canonicalInstanceKeyValue({ id: 'p2', org: 'acme' }, ['org', 'id'])}`,
        queryName: 'product',
      },
    ]);
    expect(deriveKeys).toHaveBeenCalledWith(submission.input);
  });

  it('rejects mismatched status and transform facts before executing a predictor', async () => {
    const predictor = vi.fn();
    const importModule = guardKovoDynamicImportModule(
      vi.fn(async () => ({
        kovoOptimisticMutationPlans: {
          'cart/add': {
            inputFields: [],
            invalidations: ['cart'],
            mutation: 'cart/add',
            schema: 'kovo.optimistic-plan/v2',
            statuses: { cart: 'await-fragment' },
            transforms: { cart: predictor },
          },
        },
      })),
      { allowedModuleUrls: [moduleHref] },
    );

    await expect(
      loadCompiledOptimisticSubmission({
        formData: new FormData(),
        importModule,
        moduleHref,
        mutation: 'cart/add',
      }),
    ).rejects.toThrow(/inconsistent status\/transform facts/u);
    expect(predictor).not.toHaveBeenCalled();
  });

  it('rejects a module that does not carry the submitted mutation identity', async () => {
    const importModule = guardKovoDynamicImportModule(
      vi.fn(async () => ({
        kovoOptimisticMutationPlans: {},
      })),
      { allowedModuleUrls: [moduleHref] },
    );

    await expect(
      loadCompiledOptimisticSubmission({
        formData: new FormData(),
        importModule,
        moduleHref,
        mutation: 'cart/add',
      }),
    ).rejects.toThrow(/no exact plan for cart\/add/u);
  });
});
