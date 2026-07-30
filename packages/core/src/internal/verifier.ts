/**
 * Package-internal verifier provenance for framework ingress consumers.
 *
 * This exports only an identity predicate backed by module-private state. It intentionally does
 * not expose a marker or branding function that authored code could use to bless structural HMAC
 * lookalikes (SPEC §9.1 verifier-before-parse).
 */
export {
  inspectFrameworkHmacSignatureVerifier,
  isFrameworkHmacSignatureVerifier,
} from '../verifier.js';
export type {
  HmacSecret,
  HmacSignatureInspectionConfig,
  HmacSignatureOptions,
  ResolvedHmacSignatureConfig,
} from '../verifier.js';
