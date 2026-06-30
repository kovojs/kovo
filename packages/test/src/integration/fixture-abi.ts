// @kovojs/test/internal/integration/fixture-abi: server-only white-box facade
// for framework-owned integration fixture app modules.

export { createMemoryStorage } from '@kovojs/core/internal/storage';
export type {
  WebhookReplayReservation,
  WebhookReplayStore,
  WebhookWireResponse,
} from '@kovojs/server/internal/wire';
export {
  escapeAttribute,
  escapeHtml,
  renderDeferredDocument,
  renderQueryScript,
} from '@kovojs/server/internal/html';
export { runQuery } from '@kovojs/server/internal/execution';
