import { isNativeRequest } from './request-carrier.js';
import {
  createWitnessWeakSet,
  witnessReflectApply,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

/** @internal Lazy source-route authorization used only after mutation lifecycle gates settle. */
export type MutationRenderRequestResolver<Request> = () => Promise<Request | undefined>;

const frameworkMutationRenderRequestResolvers = createWitnessWeakSet<object>();

/** @internal Mint framework-only authority for a source-route render-request resolver. */
export function frameworkMutationRenderRequestResolver<Request>(
  resolver: MutationRenderRequestResolver<Request>,
): MutationRenderRequestResolver<Request> {
  if (typeof resolver !== 'function') {
    throw new TypeError('Mutation render-request resolver must be a function.');
  }
  witnessWeakSetAdd(frameworkMutationRenderRequestResolvers, resolver);
  return resolver;
}

/** @internal Resolve a framework-minted source request without executing structural lookalikes. */
export async function resolveFrameworkMutationRenderRequest<Request>(
  resolver: MutationRenderRequestResolver<Request> | undefined,
  fallback: Request,
): Promise<Request | undefined> {
  if (resolver === undefined) return fallback;
  if (
    typeof resolver !== 'function' ||
    !witnessWeakSetHas(frameworkMutationRenderRequestResolvers, resolver)
  ) {
    throw new TypeError('Mutation render-request resolver lacks framework authority.');
  }
  const resolved = await witnessReflectApply<Promise<Request | undefined>>(resolver, undefined, []);
  if (resolved === undefined) return undefined;
  if (!isNativeRequest(resolved)) {
    throw new TypeError('Mutation render-request resolver must return a genuine Request carrier.');
  }
  return resolved;
}
