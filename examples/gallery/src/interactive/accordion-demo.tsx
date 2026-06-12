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
      >
        <section {...accordionItemAttributes(shippingState)} class="grid gap-1">
          <h3 {...accordionHeaderAttributes({ ...shippingState, level: 3 })}>
            <button
              {...accordionTriggerAttributes({
                ...shippingState,
                contentId: 'gallery-accordion-shipping-content',
                triggerId: 'gallery-accordion-shipping-trigger',
              })}
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
          >
            Billing contacts receive invoice updates.
          </div>
        </section>
        <output data-demo-state="accordion-value">{state.value || 'none'}</output>
      </section>
    );
  },
});
