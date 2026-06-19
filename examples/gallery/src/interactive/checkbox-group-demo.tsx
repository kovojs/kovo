/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { checkboxTriggerClick as _checkboxTriggerClick } from '@kovojs/headless-ui/checkbox';
import { checkboxGroupItemClick as _checkboxGroupItemClick } from '@kovojs/headless-ui/checkbox-group';
import {
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
} from '@kovojs/ui/checkbox-group';

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
      <CheckboxGroup
        {...groupState}
        data-gallery-interactive="checkbox-group"
        labelledBy="gallery-checkbox-group-label"
      >
        <form id="gallery-checkbox-group-form" data-gallery-form="checkbox-group" />
        <h3 id="gallery-checkbox-group-label" style="font-size:0.875rem;font-weight:500">
          Notifications
        </h3>
        <label style="display:inline-flex;align-items:center;gap:0.5rem">
          <input
            aria-checked={
              state.value === 'updates,billing' ? 'true' : state.value === '' ? 'false' : 'mixed'
            }
            checked={state.value === 'updates,billing'}
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
          <span>All notifications</span>
        </label>
        <CheckboxGroupItem {...updatesState}>
          <CheckboxGroupControl
            {...updatesState}
            aria-checked={String(state.value === 'updates' || state.value === 'updates,billing')}
            checked={state.value === 'updates' || state.value === 'updates,billing'}
            controlId="gallery-checkbox-group-updates"
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
          <CheckboxGroupLabel
            {...updatesState}
            controlId="gallery-checkbox-group-updates"
            data-state={
              state.value === 'updates' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
          >
            Product updates
          </CheckboxGroupLabel>
        </CheckboxGroupItem>
        <CheckboxGroupItem {...billingState}>
          <CheckboxGroupControl
            {...billingState}
            aria-checked={String(state.value === 'billing' || state.value === 'updates,billing')}
            checked={state.value === 'billing' || state.value === 'updates,billing'}
            controlId="gallery-checkbox-group-billing"
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
          <CheckboxGroupLabel
            {...billingState}
            controlId="gallery-checkbox-group-billing"
            data-state={
              state.value === 'billing' || state.value === 'updates,billing'
                ? 'checked'
                : 'unchecked'
            }
          >
            Billing notices
          </CheckboxGroupLabel>
        </CheckboxGroupItem>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="checkbox-group-value"
        >
          {state.value || 'none'}
        </output>
      </CheckboxGroup>
    );
  },
});
