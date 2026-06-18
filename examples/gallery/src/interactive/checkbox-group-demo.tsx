/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { checkboxTriggerClick as _checkboxTriggerClick } from '@kovojs/headless-ui/checkbox';
import {
  checkboxGroupClasses,
  checkboxGroupItemClasses,
  checkboxGroupControlClasses,
  checkboxGroupLabelClasses,
} from '@kovojs/ui/checkbox-group';

import {
  checkboxGroupItemClick as _checkboxGroupItemClick,
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
} from '@kovojs/headless-ui/checkbox-group';

const ROOT_CLASS = checkboxGroupClasses.join(' ');
const ITEM_CLASS = checkboxGroupItemClasses.join(' ');
const CONTROL_CLASS = checkboxGroupControlClasses.join(' ');
const LABEL_CLASS = checkboxGroupLabelClasses.join(' ');

export interface GalleryCheckboxGroupDemoState {
  activeValue: string;
  value: string;
}

const checkboxItems = Object.freeze([{ value: 'updates' }, { value: 'billing' }]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryCheckboxGroupDemo = component({
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
      >
        <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
        <h3 id="gallery-checkbox-group-label" class="text-sm font-medium">
          Notifications
        </h3>
        <label class={ITEM_CLASS}>
          <input
            aria-checked={
              state.value === 'updates,billing' ? 'true' : state.value === '' ? 'false' : 'mixed'
            }
            checked={state.value === 'updates,billing'}
            class={CONTROL_CLASS}
            data-state={
              state.value === 'updates,billing'
                ? 'checked'
                : state.value === ''
                  ? 'unchecked'
                  : 'indeterminate'
            }
            id="gallery-checkbox-group-all"
            indeterminate={state.value !== '' && state.value !== 'updates,billing'}
            onClick={() => {
              const result = _checkboxTriggerClick(Object(event), {
                checked:
                  state.value === 'updates,billing'
                    ? true
                    : state.value === ''
                      ? false
                      : 'indeterminate',
              });
              if (!result) return;
              state.value = result.checked === true ? 'updates,billing' : '';
            }}
            type="checkbox"
          />
          <span class={LABEL_CLASS}>All notifications</span>
        </label>
        <div {...checkboxGroupItemAttributes(updatesState)} class={ITEM_CLASS}>
          <input
            {...checkboxGroupControlAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            aria-checked={String(state.value === 'updates' || state.value === 'updates,billing')}
            checked={state.value === 'updates' || state.value === 'updates,billing'}
            class={CONTROL_CLASS}
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            onClick={() => {
              const result = _checkboxGroupItemClick(Object(event), {
                itemValue: 'updates',
                items: [{ value: 'updates' }, { value: 'billing' }],
                value:
                  state.value === 'updates,billing'
                    ? ['updates', 'billing']
                    : state.value === ''
                      ? []
                      : [state.value],
              });
              if (!result) return;
              state.activeValue = 'updates';
              state.value = result.value.toString();
            }}
            tabIndex={0}
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...updatesState,
              controlId: 'gallery-checkbox-group-updates',
            })}
            class={LABEL_CLASS}
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
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
            aria-checked={String(state.value === 'billing' || state.value === 'updates,billing')}
            checked={state.value === 'billing' || state.value === 'updates,billing'}
            class={CONTROL_CLASS}
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
            onClick={() => {
              const result = _checkboxGroupItemClick(Object(event), {
                itemValue: 'billing',
                items: [{ value: 'updates' }, { value: 'billing' }],
                value:
                  state.value === 'updates,billing'
                    ? ['updates', 'billing']
                    : state.value === ''
                      ? []
                      : [state.value],
              });
              if (!result) return;
              state.activeValue = 'billing';
              state.value = result.value.toString();
            }}
            tabIndex={0}
          />
          <label
            {...checkboxGroupLabelAttributes({
              ...billingState,
              controlId: 'gallery-checkbox-group-billing',
            })}
            class={LABEL_CLASS}
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
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
