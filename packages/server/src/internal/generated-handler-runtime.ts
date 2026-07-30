import '../security-bootstrap.js';

// SPEC §5.2/§6.6: emitted server handlers must import a runtime-only graph. The Vite integration
// barrel also owns compiler and static-analysis tooling, so importing these values from that barrel
// would retain TypeScript's dynamic module loader in production artifacts.
export { createRequestHandler } from '../app.js';
export { deriveClosedKovoApp } from '../app-snapshot.js';
export { runWithGeneratedLiveTargetRegistry } from '../live-target-registry.js';
