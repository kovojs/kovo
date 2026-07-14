/**
 * Lock classifier-reviewed Web globals before a custom non-Node app graph is evaluated.
 *
 * Import `@kovojs/server/runtime-bootstrap` as the first import in a custom runtime entry. Kovo's
 * generated entries install the same lock automatically. This side-effect entry intentionally has
 * no Node builtin edges, so Worker runtimes can load it (SPEC §6.6 bootstrap rule).
 */
import { lockServerRequestSafeRuntimeRealm } from './security-bootstrap.ts';

lockServerRequestSafeRuntimeRealm();

export {};
