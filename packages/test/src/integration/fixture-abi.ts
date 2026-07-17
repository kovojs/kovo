// @kovojs/test/internal/integration/fixture-abi: server-only white-box facade
// for framework-owned integration fixture app modules.

import { stampStaticSql } from '@kovojs/core/internal/sql-safety';
import { verifierDenseArraySnapshot, verifierTypeError } from '../verifier-security-intrinsics.js';

export { createMemoryStorage } from '@kovojs/core/internal/storage';
export type {
  WebhookReplayIdentity,
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

/** @internal Fixture-only static SQL carrier for framework-owned integration apps. */
export interface FixtureStaticSql {
  readonly queryChunks: readonly [{ readonly value: readonly [string] }];
}

/** @internal Tag literal-only fixture SQL so strict managed-DB guards accept it. */
export function staticSql(strings: TemplateStringsArray, ...values: never[]): FixtureStaticSql {
  const expressions = verifierDenseArraySnapshot(
    values,
    'fixture staticSql interpolation list',
    (value) => value,
  );
  if (expressions.length > 0) {
    throw verifierTypeError('fixture staticSql accepts literal-only SQL text.');
  }
  const chunks = verifierDenseArraySnapshot(
    strings,
    'fixture staticSql template chunks',
    (chunk) => {
      if (typeof chunk !== 'string') {
        throw verifierTypeError('fixture staticSql template chunks must be strings.');
      }
      return chunk;
    },
  );
  if (chunks.length !== 1) {
    throw verifierTypeError('fixture staticSql requires exactly one literal template chunk.');
  }
  return stampStaticSql({ queryChunks: [{ value: [chunks[0]!] }] });
}
