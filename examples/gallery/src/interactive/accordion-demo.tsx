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
