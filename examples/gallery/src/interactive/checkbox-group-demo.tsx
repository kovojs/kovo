/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { checkboxTriggerClick as _checkboxTriggerClick } from '@kovojs/headless-ui/checkbox';
import { checkboxGroupItemClick as _checkboxGroupItemClick } from '@kovojs/headless-ui/checkbox-group';
import { Checkbox } from '@kovojs/ui/checkbox';
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
        {/* C unblock (plans/more-ui-primitives.md): the styled select-all
            Checkbox. data-bind-prop:checked / :indeterminate keep the inner
            input's dirty .checked / .indeterminate properties correct after
            interaction (SPEC §4.8), so the native form/a11y state stays right
            across select-all on/off/indeterminate without a bare-input downgrade.
            It carries no `name`, so it never joins the form's FormData. */}
        <Checkbox
          checked={
            state.value === 'updates,billing' ? true : state.value === '' ? false : 'indeterminate'
          }
          id="gallery-checkbox-group-all"
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
        >
          All notifications
        </Checkbox>
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
