// @ts-nocheck -- migration refusal intentionally imports the retired query optimism support surface.
import type {
  KeyedQueryOptimisticOptions,
  QueryOptimisticApply,
  QueryOptimisticBinding,
  QueryOptimisticStatus,
} from '@kovojs/server';

export type LegacyQueryOptimism =
  | KeyedQueryOptimisticOptions<unknown, unknown, unknown>
  | QueryOptimisticApply<unknown, unknown>
  | QueryOptimisticBinding
  | QueryOptimisticStatus;
