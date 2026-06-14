/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionRootAttributes,
  accordionTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/accordion.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ITEM_CLASS = 'rounded-md border border-neutral-200 bg-white data-[disabled]:opacity-50';
const HEADER_CLASS = 'm-0 text-sm font-medium';
const TRIGGER_CLASS =
  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none data-[state=open]:bg-neutral-50 data-[disabled]:opacity-50';
const CONTENT_CLASS = 'px-3 pb-3 pt-1 text-sm text-neutral-700 data-[state=closed]:hidden';

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
        class="grid w-full gap-2 text-sm text-neutral-950"
        data-gallery-interactive="accordion"
      >
        <section {...accordionItemAttributes(shippingState)} class={ITEM_CLASS}>
          <h3
            {...accordionHeaderAttributes({ ...shippingState, level: 3 })}
            class={HEADER_CLASS}
          >
            <button
              {...accordionTriggerAttributes({
                ...shippingState,
                contentId: 'gallery-accordion-shipping-content',
                triggerId: 'gallery-accordion-shipping-trigger',
              })}
              class={TRIGGER_CLASS}
              onClick={() => {
                state.value = state.value === 'shipping' ? '' : 'shipping';
                const doc = Reflect['get'](globalThis, 'document');
                const shippingTrigger = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-trigger')
                  : undefined;
                const billingTrigger = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-trigger')
                  : undefined;
                const shippingPanel = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-content')
                  : undefined;
                const billingPanel = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-content')
                  : undefined;
                const output = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="accordion-value"]')
                  : undefined;

                if (shippingTrigger)
                  Object(shippingTrigger)['setAttribute']?.call(
                    shippingTrigger,
                    'aria-expanded',
                    state.value === 'shipping' ? 'true' : 'false',
                  );
                if (billingTrigger)
                  Object(billingTrigger)['setAttribute']?.call(
                    billingTrigger,
                    'aria-expanded',
                    state.value === 'billing' ? 'true' : 'false',
                  );
                if (shippingPanel) shippingPanel['hidden'] = state.value !== 'shipping';
                if (billingPanel) billingPanel['hidden'] = state.value !== 'billing';
                if (output) output['textContent'] = state.value || 'none';
              }}
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
          >
            Shipping windows are selected during checkout.
          </div>
        </section>
        <section {...accordionItemAttributes(billingState)} class={ITEM_CLASS}>
          <h3
            {...accordionHeaderAttributes({ ...billingState, level: 3 })}
            class={HEADER_CLASS}
          >
            <button
              {...accordionTriggerAttributes({
                ...billingState,
                contentId: 'gallery-accordion-billing-content',
                triggerId: 'gallery-accordion-billing-trigger',
              })}
              class={TRIGGER_CLASS}
              onClick={() => {
                state.value = state.value === 'billing' ? '' : 'billing';
                const doc = Reflect['get'](globalThis, 'document');
                const shippingTrigger = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-trigger')
                  : undefined;
                const billingTrigger = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-trigger')
                  : undefined;
                const shippingPanel = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-content')
                  : undefined;
                const billingPanel = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-content')
                  : undefined;
                const output = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="accordion-value"]')
                  : undefined;

                if (shippingTrigger)
                  Object(shippingTrigger)['setAttribute']?.call(
                    shippingTrigger,
                    'aria-expanded',
                    state.value === 'shipping' ? 'true' : 'false',
                  );
                if (billingTrigger)
                  Object(billingTrigger)['setAttribute']?.call(
                    billingTrigger,
                    'aria-expanded',
                    state.value === 'billing' ? 'true' : 'false',
                  );
                if (shippingPanel) shippingPanel['hidden'] = state.value !== 'shipping';
                if (billingPanel) billingPanel['hidden'] = state.value !== 'billing';
                if (output) output['textContent'] = state.value || 'none';
              }}
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
