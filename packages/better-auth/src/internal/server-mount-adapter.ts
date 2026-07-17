// Keep the shared bootstrap-order witness as this executable entry's first dependency.
import './runtime-lock.js';

/**
 * Server-side validation and invocation of an opaque Kovo-owned Better Auth mount adapter.
 * No minting function or raw handler is exported from this published internal entry.
 *
 * @internal
 */
export {
  assertBetterAuthMountAdapter,
  invokeBetterAuthMountAdapter,
  type BetterAuthMountAdapter,
} from '../mount-adapter.js';
