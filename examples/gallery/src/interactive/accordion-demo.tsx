/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionKeyDown as _accordionKeyDown,
  accordionRootAttributes,
  accordionTriggerAttributes,
  accordionTriggerClick as _accordionTriggerClick,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/accordion.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
          const next = Object(root)?.querySelector?.(`[value="${result.value}"]`);
          Object(next)['focus']?.call(next);
        }}
      >
        <section
          {...accordionItemAttributes(shippingState)}
          class={ITEM_CLASS}
          data-state={state.value === 'shipping' ? 'open' : 'closed'}
        >
          <h3 {...accordionHeaderAttributes({ ...shippingState, level: 3 })} class={HEADER_CLASS}>
            <button
              {...accordionTriggerAttributes({
                ...shippingState,
                contentId: 'gallery-accordion-shipping-content',
                triggerId: 'gallery-accordion-shipping-trigger',
              })}
              aria-expanded={String(state.value === 'shipping')}
              class={TRIGGER_CLASS}
              data-state={state.value === 'shipping' ? 'open' : 'closed'}
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
              value="shipping"
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
            class={CONTENT_CLASS}
            data-state={state.value === 'shipping' ? 'open' : 'closed'}
            hidden={state.value !== 'shipping'}
          >
            Shipping windows are selected during checkout.
          </div>
        </section>
        <section
          {...accordionItemAttributes(billingState)}
          class={ITEM_CLASS}
          data-state={state.value === 'billing' ? 'open' : 'closed'}
        >
          <h3 {...accordionHeaderAttributes({ ...billingState, level: 3 })} class={HEADER_CLASS}>
            <button
              {...accordionTriggerAttributes({
                ...billingState,
                contentId: 'gallery-accordion-billing-content',
                triggerId: 'gallery-accordion-billing-trigger',
              })}
              aria-expanded={String(state.value === 'billing')}
              class={TRIGGER_CLASS}
              data-state={state.value === 'billing' ? 'open' : 'closed'}
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
              value="billing"
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
            class={CONTENT_CLASS}
            data-state={state.value === 'billing' ? 'open' : 'closed'}
            hidden={state.value !== 'billing'}
          >
            Billing contacts receive invoice updates.
          </div>
        </section>
        <output class="text-xs text-neutral-500" data-demo-state="accordion-value">
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
