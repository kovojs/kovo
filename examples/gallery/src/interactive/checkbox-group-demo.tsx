/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/checkbox-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[orientation=horizontal]:flex data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:items-center data-[invalid]:text-red-950';
const ITEM_CLASS =
  'inline-flex items-center gap-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const CONTROL_CLASS =
  'h-4 w-4 rounded border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';
const LABEL_CLASS = 'select-none leading-none data-[disabled]:cursor-not-allowed';

export interface GalleryCheckboxGroupDemoState {
  activeValue: string;
  value: string;
}

const checkboxItems = Object.freeze([{ value: 'updates' }, { value: 'billing' }]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryCheckboxGroupDemo = component('gallery-checkbox-group-demo', {
  state: () => ({ activeValue: 'updates', value: 'updates' }),
  render: (_queries: Record<string, never>, state: GalleryCheckboxGroupDemoState) => {
    const selectedValues =
      state.value === 'updates,billing'
        ? ['updates', 'billing']
        : state.value === ''
          ? []
          : [state.value];
    const groupState = {
      activeValue: state.activeValue,
      form: 'gallery-checkbox-group-form',
      items: checkboxItems,
      name: 'gallery-notifications',
      value: selectedValues,
    };
    const updatesState = { ...groupState, itemValue: 'updates' };
    const billingState = { ...groupState, itemValue: 'billing' };

    return (
      <section
        {...checkboxGroupRootAttributes({
          ...groupState,
          labelledBy: 'gallery-checkbox-group-label',
        })}
        class={ROOT_CLASS}
        data-gallery-interactive="checkbox-group"
        onKeyDown={() => {
          if (
            event &&
            Object(event)['key'] !== 'ArrowDown' &&
            Object(event)['key'] !== 'ArrowLeft' &&
            Object(event)['key'] !== 'ArrowRight' &&
            Object(event)['key'] !== 'ArrowUp' &&
            Object(event)['key'] !== 'End' &&
            Object(event)['key'] !== 'Home'
          ) {
            return;
          }
          if (event) Object(event)['preventDefault']?.call(event);
          state.activeValue = state.activeValue === 'updates' ? 'billing' : 'updates';
          const doc = Reflect['get'](globalThis, 'document');
          const updates = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
            : undefined;
          const billing = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
            : undefined;

          if (updates) updates['tabIndex'] = state.activeValue === 'updates' ? 0 : -1;
          if (billing) {
            billing['tabIndex'] = state.activeValue === 'billing' ? 0 : -1;
            if (state.activeValue === 'billing') Object(billing)['focus']?.call(billing);
          }
          if (updates && state.activeValue === 'updates') Object(updates)['focus']?.call(updates);
        }}
      >
        <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
        <h3 id="gallery-checkbox-group-label" class="text-sm font-medium">
          Notifications
        </h3>
        <div {...checkboxGroupItemAttributes(updatesState)} class={ITEM_CLASS}>
          <input
            {...checkboxGroupControlAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            class={CONTROL_CLASS}
            onClick={() => {
              state.value =
                state.value === 'updates,billing'
                  ? 'billing'
                  : state.value === 'updates'
                    ? ''
                    : state.value === 'billing'
                      ? 'updates,billing'
                      : 'updates';
              const doc = Reflect['get'](globalThis, 'document');
              const updates = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
                : undefined;
              const billing = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(
                    doc,
                    '[data-demo-state="checkbox-group-value"]',
                  )
                : undefined;
              const updatesChecked = state.value === 'updates' || state.value === 'updates,billing';
              const billingChecked = state.value === 'billing' || state.value === 'updates,billing';

              if (updates) {
                updates['checked'] = updatesChecked;
                Object(updates)['setAttribute']?.call(
                  updates,
                  'aria-checked',
                  updatesChecked ? 'true' : 'false',
                );
                Object(updates)['setAttribute']?.call(
                  updates,
                  'data-state',
                  updatesChecked ? 'checked' : 'unchecked',
                );
              }
              if (billing) {
                billing['checked'] = billingChecked;
                Object(billing)['setAttribute']?.call(
                  billing,
                  'aria-checked',
                  billingChecked ? 'true' : 'false',
                );
                Object(billing)['setAttribute']?.call(
                  billing,
                  'data-state',
                  billingChecked ? 'checked' : 'unchecked',
                );
              }
              if (output) output['textContent'] = state.value || 'none';
            }}
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            class={LABEL_CLASS}
          >
            Product updates
          </label>
        </div>
        <div {...checkboxGroupItemAttributes(billingState)} class={ITEM_CLASS}>
          <input
            {...checkboxGroupControlAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            class={CONTROL_CLASS}
            onClick={() => {
              state.value =
                state.value === 'updates,billing'
                  ? 'updates'
                  : state.value === 'billing'
                    ? ''
                    : state.value === 'updates'
                      ? 'updates,billing'
                      : 'billing';
              const doc = Reflect['get'](globalThis, 'document');
              const updates = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
                : undefined;
              const billing = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(
                    doc,
                    '[data-demo-state="checkbox-group-value"]',
                  )
                : undefined;
              const updatesChecked = state.value === 'updates' || state.value === 'updates,billing';
              const billingChecked = state.value === 'billing' || state.value === 'updates,billing';

              if (updates) {
                updates['checked'] = updatesChecked;
                Object(updates)['setAttribute']?.call(
                  updates,
                  'aria-checked',
                  updatesChecked ? 'true' : 'false',
                );
                Object(updates)['setAttribute']?.call(
                  updates,
                  'data-state',
                  updatesChecked ? 'checked' : 'unchecked',
                );
              }
              if (billing) {
                billing['checked'] = billingChecked;
                Object(billing)['setAttribute']?.call(
                  billing,
                  'aria-checked',
                  billingChecked ? 'true' : 'false',
                );
                Object(billing)['setAttribute']?.call(
                  billing,
                  'data-state',
                  billingChecked ? 'checked' : 'unchecked',
                );
              }
              if (output) output['textContent'] = state.value || 'none';
            }}
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            class={LABEL_CLASS}
          >
            Billing notices
          </label>
        </div>
        <output class="text-xs text-neutral-500" data-demo-state="checkbox-group-value">
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
