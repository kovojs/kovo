// Framework-owned Vitest seam. Example app modules remain pure, and production runners retain the
// guarded public wrapper; only the configured example tests import this internal raw dispatcher.
export { createRequestHandler as createExampleTestRequestHandler } from '../packages/server/src/app.js';
