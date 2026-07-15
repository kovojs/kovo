/**
 * Framework-owned minting entry for opaque, purpose-scoped CSRF signing authority.
 *
 * @internal App-authored modules use public CSRF configuration surfaces; only reviewed
 * first-party integration packages mint this capability (SPEC §6.6 C9).
 */
export { createFrameworkCsrfSigningSecret } from '../keyring.js';
