import { describe, expect, it, vi } from 'vitest';

import {
  frameworkMutationRenderRequestResolver,
  resolveFrameworkMutationRenderRequest,
} from './mutation-render-request-authority.js';

describe('mutation render-request authority', () => {
  it('uses the lifecycle request for direct internal callers without a resolver', async () => {
    const request = { direct: true };
    await expect(resolveFrameworkMutationRenderRequest(undefined, request)).resolves.toBe(request);
  });

  it('does not execute an unminted structural resolver', async () => {
    const resolver = vi.fn(async () => new Request('https://app.test/private'));

    await expect(
      resolveFrameworkMutationRenderRequest(resolver, new Request('https://app.test/_m/save')),
    ).rejects.toThrow(/lacks framework authority/u);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('accepts only a genuine Request from a framework-minted resolver', async () => {
    const sourceRequest = new Request('https://app.test/account');
    const resolver = frameworkMutationRenderRequestResolver(async () => sourceRequest);
    await expect(
      resolveFrameworkMutationRenderRequest(resolver, new Request('https://app.test/_m/save')),
    ).resolves.toBe(sourceRequest);

    const forged = frameworkMutationRenderRequestResolver(async () => ({ url: sourceRequest.url }));
    await expect(
      resolveFrameworkMutationRenderRequest(
        forged as never,
        new Request('https://app.test/_m/save'),
      ),
    ).rejects.toThrow(/genuine Request carrier/u);
  });
});
