/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { advance } from './app';
import { wireQuery } from './shared';

const advanceForm = form<'fragment-targets-live-dom/advance', Record<string, never>>(
  'fragment-targets-live-dom/advance',
);

const DynamicPanel = component({
  queries: { wire: wireQuery },
  render: ({ wire }: { wire: { stage: number } }) => (
    <dynamic-panel>
      <output>Panel {wire.stage}</output>
    </dynamic-panel>
  ),
});

export const Launcher = component({
  mutations: { advance: advanceForm },
  queries: { wire: wireQuery },
  render: ({ wire }: { wire: { stage: number } }) => (
    <section>
      <output>Stage {wire.stage}</output>
      {wire.stage > 0 ? <DynamicPanel /> : null}
      <form mutation={advance} enhance>
        <button type="submit">{wire.stage === 0 ? 'Install panel' : 'Refresh panel'}</button>
      </form>
    </section>
  ),
});
