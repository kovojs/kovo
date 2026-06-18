/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  accordionKeyDown as _accordionKeyDown,
  AccordionTrigger,
  accordionTriggerClick as _accordionTriggerClick,
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
        collapsible
        data-gallery-interactive="accordion"
        onKeyDown={() => {
          const result = _accordionKeyDown(Object(event), {
            activeValue: state.activeValue,
            items: [{ value: 'shipping' }, { value: 'billing' }],
            type: 'single',
            value: state.value || undefined,
          });
          if (!result?.value) return;
          state.activeValue = result.value;
          const root = Object(event)['target']?.closest?.('[data-gallery-interactive="accordion"]');
          const next = Object(root)?.querySelector?.(`#gallery-accordion-${result.value}-trigger`);
          Object(next)['focus']?.call(next);
        }}
        type="single"
        value={state.value || undefined}
      >
        <AccordionItem
          collapsible
          itemValue="shipping"
          type="single"
          value={state.value || undefined}
        >
          <AccordionHeader
            collapsible
            itemValue="shipping"
            level={3}
            type="single"
            value={state.value || undefined}
          >
            <AccordionTrigger
              collapsible
              contentId="gallery-accordion-shipping-content"
              itemValue="shipping"
              onClick={() => {
                const result = _accordionTriggerClick(Object(event), {
                  collapsible: true,
                  itemValue: 'shipping',
                  type: 'single',
                  value: state.value || undefined,
                });
                if (!result) return;
                state.activeValue = 'shipping';
                state.value = result.value?.toString() ?? '';
              }}
              tabIndex={state.activeValue === 'shipping' ? 0 : -1}
              triggerId="gallery-accordion-shipping-trigger"
              type="single"
              value={state.value || undefined}
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
          >
            Shipping windows are selected during checkout.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem
          collapsible
          itemValue="billing"
          type="single"
          value={state.value || undefined}
        >
          <AccordionHeader
            collapsible
            itemValue="billing"
            level={3}
            type="single"
            value={state.value || undefined}
          >
            <AccordionTrigger
              collapsible
              contentId="gallery-accordion-billing-content"
              itemValue="billing"
              onClick={() => {
                const result = _accordionTriggerClick(Object(event), {
                  collapsible: true,
                  itemValue: 'billing',
                  type: 'single',
                  value: state.value || undefined,
                });
                if (!result) return;
                state.activeValue = 'billing';
                state.value = result.value?.toString() ?? '';
              }}
              tabIndex={state.activeValue === 'billing' ? 0 : -1}
              triggerId="gallery-accordion-billing-trigger"
              type="single"
              value={state.value || undefined}
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
          >
            Billing contacts receive invoice updates.
          </AccordionContent>
        </AccordionItem>
        <output class="text-xs text-neutral-500" data-demo-state="accordion-value">
          {state.value || 'none'}
        </output>
      </Accordion>
    );
  },
});
