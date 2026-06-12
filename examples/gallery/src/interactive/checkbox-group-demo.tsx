/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

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
        class="grid gap-2"
        data-gallery-interactive="checkbox-group"
        onKeyDown={() => {
          state.activeValue = state.activeValue === 'updates' ? 'billing' : 'updates';
          const doc = Reflect['get'](globalThis, 'document');
          const updates = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
            : undefined;
          const billing = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
            : undefined;

          if (updates) updates['tabIndex'] = state.activeValue === 'updates' ? 0 : -1;
          if (billing) billing['tabIndex'] = state.activeValue === 'billing' ? 0 : -1;
        }}
      >
        <h3 id="gallery-checkbox-group-label">Notifications</h3>
        <div {...checkboxGroupItemAttributes(updatesState)} class="inline-flex items-center gap-2">
          <input
            {...checkboxGroupControlAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
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
          >
            Product updates
          </label>
        </div>
        <div {...checkboxGroupItemAttributes(billingState)} class="inline-flex items-center gap-2">
          <input
            {...checkboxGroupControlAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
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
          >
            Billing notices
          </label>
        </div>
        <output data-demo-state="checkbox-group-value">{state.value || 'none'}</output>
      </section>
    );
  },
});
