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
