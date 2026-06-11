// @jiso-ir — lowered from site/tutorial/steps/02-islands/src/components/product-actions.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `node site/tutorial/run-steps.mjs --write`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';

// Tutorial step 02 (chapter 2): the interaction ladder in one component
// (SPEC.md section 7). The size-guide button is L0 — the compiler proves the
// closure equivalent to a platform invoker and emits popovertarget instead of
// JavaScript (SPEC.md section 5.2 rule 4). The save button is L1 — an island
// whose handler loads on first interaction (SPEC.md section 4.3). Authored
// sugar carries no stamps (SPEC.md section 4.1); the committed lowered IR in
// ../generated/ is what the app imports.

// A type alias (not an interface) so TypeScript can prove assignability to
// the JsonValue state constraint (SPEC.md section 4.1: serializable by
// construction).
export type ProductActionsState = {
  saved: number;
};

// snippet:product-actions
export const ProductActions = component('product-actions', {
  state: (): ProductActionsState => ({ saved: 0 }),
  render: (_queries: Record<string, never>, state: ProductActionsState) => (
    <product-actions fw-state="{&quot;saved&quot;:0}">
      <button type="button" popovertarget="size-guide" popovertargetaction="toggle">
        Size guide
      </button>
      <div id="size-guide" popover="auto">
        <p>Kettle height 24cm, base diameter 12cm.</p>
      </div>
      <button
        type="button"
        class="save"
        on:click="/c/site/tutorial/steps/02-islands/src/components/product-actions.client.js?v=d6367805#ProductActions$button_click"
      >
        Save for later
      </button>
    </product-actions>
  ),
});
// /snippet
