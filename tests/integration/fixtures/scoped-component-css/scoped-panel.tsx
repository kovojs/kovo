/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

export const ScopedPanel = component({
  css: `
    .panel-title { color: rgb(12, 84, 96); }
    .nested-copy { color: rgb(170, 0, 0); }
  `,
  render: () => (
    <section>
      <h2 class="panel-title">Scoped panel</h2>
      <aside kovo-c="nested-badge">
        <span class="nested-copy" data-nested-copy>
          Nested copy
        </span>
      </aside>
    </section>
  ),
});

export const NestedBadge = component({
  render: () => (
    <aside>
      <span>Nested component identity</span>
    </aside>
  ),
});
