/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { guardedCountQuery } from './shared';

const incrementForm = form<'guarded-mutation/increment', Record<string, never>>(
  'guarded-mutation/increment',
);

export const GuardedPanel = component({
  mutations: { increment: incrementForm },
  queries: { guardedCount: guardedCountQuery },
  render: ({ guardedCount }: { guardedCount: { count: number } }) => (
    <section>
      <output data-count>{guardedCount.count}</output>
      <form mutation={incrementForm} enhance>
        <button type="submit">Increment protected counter</button>
      </form>
    </section>
  ),
});
