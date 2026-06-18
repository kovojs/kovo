// Public exports for the CRM demo: schema, queries, mutations, and the generated
// invalidation graph used by the interactive app.

export * from './schema.js';
export * from './db.js';
export * from './model.js';
export * from './queries.js';
export * from './mutations.js';
export { createCrmGraph, crmGraphDeclarations } from './graph.js';

export { crmTouchGraph, crmInvalidationSets } from './generated/touch-graph.js';
export type { CrmInvalidationSets } from './generated/touch-graph.js';
