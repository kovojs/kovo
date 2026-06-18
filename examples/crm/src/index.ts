// SPEC.md §10.1–§10.5: the CRM example's public surface. A FOCUSED data +
// optimism example: real Drizzle schema/queries/mutations, a compiler-DERIVED
// optimism plan for the pairs the deriver can lower, and HAND-WRITTEN custom
// optimism (the §10.4 override path) for the out-of-grammar / opaque pairs.
// The runnable app-shell is the small interactive surface in app-shell.ts.

export * from './schema.js';
export * from './db.js';
export * from './domains.js';
export * from './forms.js';
export * from './queries.js';
export * from './mutations.js';
export { createCrmGraph, crmGraphDeclarations } from './graph.js';

// Anchor the generated registry augmentation (QueryRegistry + InvalidationSets)
// and re-export the extracted touch graph + invalidation sets.
export { crmTouchGraph, crmInvalidationSets } from './generated/touch-graph.js';
export type { CrmInvalidationSets } from './generated/touch-graph.js';
