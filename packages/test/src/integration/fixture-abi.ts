// @kovojs/test/internal/integration/fixture-abi: server-only white-box facade
// for framework-owned integration fixture app modules.

import { stampStaticSql } from '@kovojs/core/internal/sql-safety';

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

export interface FixtureStaticSql {
  readonly queryChunks: readonly [{ readonly value: readonly [string] }];
}

export function staticSql(strings: TemplateStringsArray, ...values: never[]): FixtureStaticSql {
  if (values.length > 0) {
    throw new Error('fixture staticSql accepts literal-only SQL text.');
  }
  return stampStaticSql({ queryChunks: [{ value: [strings.join('')] }] });
}
