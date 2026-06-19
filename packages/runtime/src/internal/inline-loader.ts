// @internal package-private inline-loader + inline-query-event engine (SPEC
// §9.4). The bundled loader source plus the raw inline-query-event hydration and
// runtime appliers are framework white-box surface — NOT part of the public
// `./client` bootstrap surface. App entries install query hydration through
// `installKovoLoader`'s query options; these raw symbols exist here only for
// framework-owned tests and emit tooling.
export {
  createInlineKovoLoaderSource,
  installInlineKovoLoader,
  kovoLoaderSource,
} from '../inline-loader.js';
export {
  applyInlineQueryEventToRuntime,
  installInlineQueryEventHydration,
} from '../query-events.js';
export type {
  ApplyInlineQueryEventOptions,
  InlineQueryEvent,
  InstallInlineQueryEventHydrationOptions,
} from '../query-events.js';
