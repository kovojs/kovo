// @kovojs-ir - lowered from examples/gallery/src/interactive/accordion-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryAccordionDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  String(state.value === 'shipping'),
);
export const GalleryAccordionDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'shipping' ? 0 : -1,
);
export const GalleryAccordionDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'shipping' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$div_hidden_derive = derive(['state'], (state: any) =>
  state.value !== 'shipping' ? '' : null,
);
export const GalleryAccordionDemo$section_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_aria_expanded_derive_2 = derive(['state'], (state: any) =>
  String(state.value === 'billing'),
);
export const GalleryAccordionDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'billing' ? 0 : -1,
);
export const GalleryAccordionDemo$div_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'billing' ? 'open' : 'closed',
);
export const GalleryAccordionDemo$div_hidden_derive_2 = derive(['state'], (state: any) =>
  state.value !== 'billing' ? '' : null,
);
export const GalleryAccordionDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.value || 'none',
);

import { component } from '@kovojs/core';
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionRootAttributes,
  accordionTriggerAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/accordion.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ITEM_CLASS = 'rounded-md border border-neutral-200 bg-white data-[disabled]:opacity-50';
const HEADER_CLASS = 'm-0 text-sm font-medium';
const TRIGGER_CLASS =
  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none data-[state=open]:bg-neutral-50 data-[disabled]:opacity-50';
const CONTENT_CLASS = 'px-3 pb-3 pt-1 text-sm text-neutral-700 data-[state=closed]:hidden';

export interface GalleryAccordionDemoState {
  activeValue: string;
  value: string;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryAccordionDemo = component({
  state: () => ({ activeValue: 'shipping', value: 'shipping' }),
  render: (_queries: Record<string, never>, state: GalleryAccordionDemoState) => {
    const rootState = {
      activeValue: state.activeValue,
      collapsible: true,
      items: [{ value: 'shipping' }, { value: 'billing' }],
      type: 'single' as const,
      value: state.value || undefined,
    };
    const shippingState = { ...rootState, itemValue: 'shipping' };
    const billingState = { ...rootState, itemValue: 'billing' };

    return (
      <section
        {...accordionRootAttributes(rootState)}
        class="grid w-full gap-2 text-sm text-neutral-950"
        data-gallery-interactive="accordion"
        on:keydown="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$section_keydown"
        kovo-c="gallery-accordion-demo"
        kovo-state='{"activeValue":"shipping","value":"shipping"}'
      >
        <section
          class={ITEM_CLASS}
          {...accordionItemAttributes(shippingState)}
          data-state={state.value === 'shipping' ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$section_data_state_derive"
        >
          <h3 class={HEADER_CLASS} {...accordionHeaderAttributes({ ...shippingState, level: 3 })}>
            <button
              class={TRIGGER_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_click"
              value="shipping"
              {...accordionTriggerAttributes({
                ...shippingState,
                contentId: 'gallery-accordion-shipping-content',
                triggerId: 'gallery-accordion-shipping-trigger',
              })}
              aria-expanded={String(state.value === 'shipping')}
              data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_aria_expanded_derive"
              data-state={state.value === 'shipping' ? 'open' : 'closed'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_data_state_derive"
              tabIndex={state.activeValue === 'shipping' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_tabIndex_derive"
            >
              Shipping
            </button>
          </h3>
          <div
            class={CONTENT_CLASS}
            {...accordionContentAttributes({
              ...shippingState,
              contentId: 'gallery-accordion-shipping-content',
              triggerId: 'gallery-accordion-shipping-trigger',
            })}
            data-state={state.value === 'shipping' ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$div_data_state_derive"
            hidden={state.value !== 'shipping'}
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$div_hidden_derive"
          >
            Shipping windows are selected during checkout.
          </div>
        </section>
        <section
          class={ITEM_CLASS}
          {...accordionItemAttributes(billingState)}
          data-state={state.value === 'billing' ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$section_data_state_derive_2"
        >
          <h3 class={HEADER_CLASS} {...accordionHeaderAttributes({ ...billingState, level: 3 })}>
            <button
              class={TRIGGER_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_click_2"
              value="billing"
              {...accordionTriggerAttributes({
                ...billingState,
                contentId: 'gallery-accordion-billing-content',
                triggerId: 'gallery-accordion-billing-trigger',
              })}
              aria-expanded={String(state.value === 'billing')}
              data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_aria_expanded_derive_2"
              data-state={state.value === 'billing' ? 'open' : 'closed'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_data_state_derive_2"
              tabIndex={state.activeValue === 'billing' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$button_tabIndex_derive_2"
            >
              Billing
            </button>
          </h3>
          <div
            class={CONTENT_CLASS}
            {...accordionContentAttributes({
              ...billingState,
              contentId: 'gallery-accordion-billing-content',
              triggerId: 'gallery-accordion-billing-trigger',
            })}
            data-state={state.value === 'billing' ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$div_data_state_derive_2"
            hidden={state.value !== 'billing'}
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$div_hidden_derive_2"
          >
            Billing contacts receive invoice updates.
          </div>
        </section>
        <output
          class="text-xs text-neutral-500"
          data-demo-state="accordion-value"
          data-bind="/c/examples/gallery/src/generated/interactive/accordion-demo.client.js?v=1a58c44a#GalleryAccordionDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
GalleryAccordionDemo.name = 'generated/interactive/accordion-demo/gallery-accordion-demo';
