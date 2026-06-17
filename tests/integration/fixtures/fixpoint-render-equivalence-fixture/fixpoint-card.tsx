/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export interface FixpointState {
  count: number;
  open: boolean;
}

export const FixpointRenderEquivalenceCard = component({
  state: () => ({ count: 2, open: false }),
  render: (_queries, rawState) => {
    const state = rawState as FixpointState;

    return (
      <fixpoint-render-equivalence-card>
        <h1>Fixpoint render equivalence</h1>
        <output>{state.count}</output>
        <button type="button" aria-expanded={state.open ? 'true' : 'false'}>
          Toggle panel
        </button>
        <section hidden={!state.open}>Panel body</section>
      </fixpoint-render-equivalence-card>
    );
  },
});
