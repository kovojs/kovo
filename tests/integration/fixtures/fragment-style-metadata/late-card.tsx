/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const LateCard = component({
  css: `
    .late-surface {
      background-color: rgb(12, 84, 96);
      color: rgb(255, 255, 255);
      padding: 12px;
    }
  `,
  render: () => (
    <section kovo-fragment-target="late-card">
      <div class="late-surface" data-late-card>
        Late styled card
      </div>
    </section>
  ),
});
