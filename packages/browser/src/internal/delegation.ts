export type { EventElementLike } from '../events.js';
export { dispatchDelegatedEvent } from '../handlers.js';
/** @internal Read an island element's `data-p-*` params (SPEC §4.3) — framework white-box, not public `./client`. */
export { readElementParams } from '../handler-context.js';
