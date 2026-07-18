/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { advance } from './app';
import { wireQuery } from './shared';

const advanceForm = form<'fragment-targets-live-dom/advance', Record<string, never>>(
  'fragment-targets-live-dom/advance',
);

export const Launcher = component({
  mutations: { advance: advanceForm },
  queries: { wire: wireQuery },
  render: ({ wire }: { wire: { stage: number } }) => (
    <section>
      <output data-bind="wire.stage">Stage {wire.stage}</output>
      {wire.stage > 0 ? (
        <section kovo-fragment-target="dynamic-panel" kovo-deps="wire">
          <output data-bind="wire.dynamic">Panel {wire.stage}</output>
        </section>
      ) : null}
      <form mutation={advance} enhance>
        <button type="submit">{wire.stage === 0 ? 'Install panel' : 'Refresh panel'}</button>
      </form>
    </section>
  ),
});
