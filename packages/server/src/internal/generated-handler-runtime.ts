import '../security-bootstrap.js';

// SPEC §5.2/§6.6: emitted server handlers must import a runtime-only graph. The Vite integration
// barrel also owns compiler and static-analysis tooling, so importing these values from that barrel
// would retain TypeScript's dynamic module loader in production artifacts.
export { createRequestHandler } from '../app.js';
export { resolveKovoAppToken } from '../app-token.js';
export { deriveClosedKovoApp } from '../app-snapshot.js';
export { runWithGeneratedLiveTargetRegistry } from '../live-target-registry.js';
// SPEC §§2/9.5/14: this is deliberately a read-only generated-handler bridge. It can
// recognize only the exact Response object marked by this module graph's private WeakMap; neither
// authored headers nor a structurally similar witness can manufacture cache authority.
export { frameworkProvedDocumentCompressionWitness as readFrameworkProvedDocumentCompressionWitnessForGeneratedHandler } from '../response.js';
