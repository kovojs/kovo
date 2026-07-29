/**
 * Framework-only confidentiality audit bridge.
 *
 * The destructive collector drain is deliberately unavailable from the app-facing
 * `@kovojs/core/security` entry point (SPEC §6.6).
 */
export { drainSecretRevealAuditFacts, type SecretRevealAuditFact } from '../secret.js';
