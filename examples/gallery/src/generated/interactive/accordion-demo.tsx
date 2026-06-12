// @jiso-ir - lowered from examples/gallery/src/interactive/accordion-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionRootAttributes,
  accordionTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryAccordionDemoState {
  value: string;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryAccordionDemo = component('gallery-accordion-demo', {
  state: () => ({ value: 'shipping' }),
  render: (_queries: Record<string, never>, state: GalleryAccordionDemoState) => {
    const rootState = {
      collapsible: true,
      type: 'single' as const,
      value: state.value,
    };
    const shippingState = { ...rootState, itemValue: 'shipping' };
    const billingState = { ...rootState, itemValue: 'billing' };

    return (
      <section
        {...accordionRootAttributes(rootState)}
        class="grid gap-2"
        data-gallery-interactive="accordion"
        fw-c="gallery-accordion-demo"
        fw-state='{"value":"shipping"}'
      >
        <section {...accordionItemAttributes(shippingState)} class="grid gap-1">
          <h3 {...accordionHeaderAttributes({ ...shippingState, level: 3 })}>
            <button
              {...accordionTriggerAttributes({
                ...shippingState,
                contentId: 'gallery-accordion-shipping-content',
                triggerId: 'gallery-accordion-shipping-trigger',
              })}
              on:click="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=eaf5df7d#GalleryAccordionDemo$button_click"
            >
              Shipping
            </button>
          </h3>
          <div
            {...accordionContentAttributes({
              ...shippingState,
              contentId: 'gallery-accordion-shipping-content',
              triggerId: 'gallery-accordion-shipping-trigger',
            })}
          >
            Shipping windows are selected during checkout.
          </div>
        </section>
        <section {...accordionItemAttributes(billingState)} class="grid gap-1">
          <h3 {...accordionHeaderAttributes({ ...billingState, level: 3 })}>
            <button
              {...accordionTriggerAttributes({
                ...billingState,
                contentId: 'gallery-accordion-billing-content',
                triggerId: 'gallery-accordion-billing-trigger',
              })}
              on:click="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=eaf5df7d#GalleryAccordionDemo$button_click_2"
            >
              Billing
            </button>
          </h3>
          <div
            {...accordionContentAttributes({
              ...billingState,
              contentId: 'gallery-accordion-billing-content',
              triggerId: 'gallery-accordion-billing-trigger',
            })}
          >
            Billing contacts receive invoice updates.
          </div>
        </section>
        <output data-demo-state="accordion-value">{state.value || 'none'}</output>
      </section>
    );
  },
});
