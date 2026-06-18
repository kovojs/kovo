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
} from '@kovojs/headless-ui/accordion';
import {
  accordionClasses,
  accordionItemClasses,
  accordionHeaderClasses,
  accordionTriggerClasses,
  accordionContentClasses,
} from '@kovojs/ui/accordion';

const ITEM_CLASS = accordionItemClasses.join(' ');
const HEADER_CLASS = accordionHeaderClasses.join(' ');
const TRIGGER_CLASS = accordionTriggerClasses.join(' ');
const CONTENT_CLASS = accordionContentClasses.join(' ');

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
        class={accordionClasses.join(' ')}
        data-gallery-interactive="accordion"
        on:keydown="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$section_keydown"
        kovo-c="gallery-accordion-demo"
        kovo-state='{"activeValue":"shipping","value":"shipping"}'
      >
        <section
          class={ITEM_CLASS}
          {...accordionItemAttributes(shippingState)}
          data-state={state.value === 'shipping' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$section_data_state_derive"
        >
          <h3 class={HEADER_CLASS} {...accordionHeaderAttributes({ ...shippingState, level: 3 })}>
            <button
              class={TRIGGER_CLASS}
              on:click="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_click"
              value="shipping"
              {...accordionTriggerAttributes({
                ...shippingState,
                contentId: 'gallery-accordion-shipping-content',
                triggerId: 'gallery-accordion-shipping-trigger',
              })}
              aria-expanded={String(state.value === 'shipping')}
              data-bind:aria-expanded="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_aria_expanded_derive"
              data-state={state.value === 'shipping' ? 'open' : 'closed'}
              data-bind:data-state="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_data_state_derive"
              tabIndex={state.activeValue === 'shipping' ? 0 : -1}
              data-bind:tabIndex="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_tabIndex_derive"
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
            data-bind:data-state="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$div_data_state_derive"
            hidden={state.value !== 'shipping'}
            data-bind:hidden="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$div_hidden_derive"
          >
            Shipping windows are selected during checkout.
          </div>
        </section>
        <section
          class={ITEM_CLASS}
          {...accordionItemAttributes(billingState)}
          data-state={state.value === 'billing' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$section_data_state_derive_2"
        >
          <h3 class={HEADER_CLASS} {...accordionHeaderAttributes({ ...billingState, level: 3 })}>
            <button
              class={TRIGGER_CLASS}
              on:click="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_click_2"
              value="billing"
              {...accordionTriggerAttributes({
                ...billingState,
                contentId: 'gallery-accordion-billing-content',
                triggerId: 'gallery-accordion-billing-trigger',
              })}
              aria-expanded={String(state.value === 'billing')}
              data-bind:aria-expanded="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_aria_expanded_derive_2"
              data-state={state.value === 'billing' ? 'open' : 'closed'}
              data-bind:data-state="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_data_state_derive_2"
              tabIndex={state.activeValue === 'billing' ? 0 : -1}
              data-bind:tabIndex="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$button_tabIndex_derive_2"
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
            data-bind:data-state="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$div_data_state_derive_2"
            hidden={state.value !== 'billing'}
            data-bind:hidden="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$div_hidden_derive_2"
          >
            Billing contacts receive invoice updates.
          </div>
        </section>
        <output
          class="text-xs text-neutral-500"
          data-demo-state="accordion-value"
          data-bind="/c/__v/d29f712e/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
GalleryAccordionDemo.name = 'generated/interactive/accordion-demo/gallery-accordion-demo';
