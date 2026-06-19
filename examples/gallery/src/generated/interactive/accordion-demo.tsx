// @kovojs-ir - lowered from examples/gallery/src/interactive/accordion-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryAccordionDemo$AccordionItem_value_derive = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionHeader_value_derive = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionTrigger_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.activeValue === 'shipping' ? 0 : -1),
);
export const GalleryAccordionDemo$AccordionTrigger_value_derive = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionContent_value_derive = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionItem_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionHeader_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionTrigger_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.activeValue === 'billing' ? 0 : -1),
);
export const GalleryAccordionDemo$AccordionTrigger_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$AccordionContent_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value || undefined,
);
export const GalleryAccordionDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.value || 'none',
);

import { component } from '@kovojs/core';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@kovojs/ui/accordion';

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

    return (
      <Accordion
        {...rootState}
        data-gallery-interactive="accordion"
        on:keydown="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$Accordion_keydown"
        kovo-state='{"activeValue":"shipping","value":"shipping"}'
      >
        <AccordionItem
          collapsible
          itemValue="shipping"
          type="single"
          value={state.value || undefined}
          data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionItem_value_derive"
        >
          <AccordionHeader
            collapsible
            itemValue="shipping"
            level={3}
            type="single"
            value={state.value || undefined}
            data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionHeader_value_derive"
          >
            <AccordionTrigger
              collapsible
              contentId="gallery-accordion-shipping-content"
              itemValue="shipping"
              on:click="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionTrigger_click"
              triggerId="gallery-accordion-shipping-trigger"
              type="single"
              tabIndex={state.activeValue === 'shipping' ? 0 : -1}
              data-bind:tabIndex="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionTrigger_tabIndex_derive"
              value={state.value || undefined}
              data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionTrigger_value_derive"
            >
              Shipping
            </AccordionTrigger>
          </AccordionHeader>
          <AccordionContent
            collapsible
            contentId="gallery-accordion-shipping-content"
            itemValue="shipping"
            triggerId="gallery-accordion-shipping-trigger"
            type="single"
            value={state.value || undefined}
            data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionContent_value_derive"
          >
            Shipping windows are selected during checkout.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem
          collapsible
          itemValue="billing"
          type="single"
          value={state.value || undefined}
          data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionItem_value_derive_2"
        >
          <AccordionHeader
            collapsible
            itemValue="billing"
            level={3}
            type="single"
            value={state.value || undefined}
            data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionHeader_value_derive_2"
          >
            <AccordionTrigger
              collapsible
              contentId="gallery-accordion-billing-content"
              itemValue="billing"
              on:click="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionTrigger_click_2"
              triggerId="gallery-accordion-billing-trigger"
              type="single"
              tabIndex={state.activeValue === 'billing' ? 0 : -1}
              data-bind:tabIndex="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionTrigger_tabIndex_derive_2"
              value={state.value || undefined}
              data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionTrigger_value_derive_2"
            >
              Billing
            </AccordionTrigger>
          </AccordionHeader>
          <AccordionContent
            collapsible
            contentId="gallery-accordion-billing-content"
            itemValue="billing"
            triggerId="gallery-accordion-billing-trigger"
            type="single"
            value={state.value || undefined}
            data-bind:value="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$AccordionContent_value_derive_2"
          >
            Billing contacts receive invoice updates.
          </AccordionContent>
        </AccordionItem>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="accordion-value"
          data-bind="/c/__v/cd3b898f/examples/gallery/src/generated/interactive/accordion-demo.client.js#GalleryAccordionDemo$output_text_derive"
        >
          {state.value || 'none'}
        </output>
      </Accordion>
    );
  },
});
GalleryAccordionDemo.name = 'generated/interactive/accordion-demo/gallery-accordion-demo';
