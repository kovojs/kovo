/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toggleGroupItemClick as _toggleGroupItemClick,
  toggleGroupKeyDown as _toggleGroupKeyDown,
} from '@kovojs/headless-ui/toggle-group';
import { ToggleGroup, ToggleGroupButton, ToggleGroupItem } from '@kovojs/ui/toggle-group';

export interface GalleryToggleGroupDemoState {
  activeValue: string;
  value: string;
}

const toggleItems = Object.freeze([
  { value: 'bold' },
  { disabled: true, value: 'strike' },
  { value: 'italic' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryToggleGroupDemo = component({
  state: () => ({ activeValue: 'bold', value: 'bold' }),
  render: (_queries: Record<string, never>, state: GalleryToggleGroupDemoState) => {
    const selectedValues =
      state.value === 'bold,italic' ? ['bold', 'italic'] : state.value === '' ? [] : [state.value];
    const groupState = {
      activeValue: state.activeValue,
      items: toggleItems,
      type: 'multiple' as const,
      value: selectedValues,
    };
    const boldState = { ...groupState, itemValue: 'bold' };
    const strikeState = { ...groupState, itemValue: 'strike' };
    const italicState = { ...groupState, itemValue: 'italic' };

    return (
      <section
        style="display:flex;flex-direction:column;align-items:flex-start;gap:0.5rem;font-size:0.875rem;color:#0a0a0a"
        data-gallery-interactive="toggle-group"
      >
        <h3 id="gallery-toggle-group-label" style="font-size:0.875rem;font-weight:500">
          Text style
        </h3>
        <ToggleGroup
          {...groupState}
          labelledBy="gallery-toggle-group-label"
          onKeyDown={() => {
            const result = _toggleGroupKeyDown(Object(event), {
              activeValue: state.activeValue,
              items: [{ value: 'bold' }, { disabled: true, value: 'strike' }, { value: 'italic' }],
              type: 'multiple',
              value:
                state.value === 'bold,italic'
                  ? ['bold', 'italic']
                  : state.value === ''
                    ? []
                    : [state.value],
            });
            if (!result?.value) return;
            state.activeValue = result.value;
            const root = Object(event)['target']?.closest?.('[role="group"]');
            const next = Object(root)?.querySelector?.(`[value="${result.value}"]`);
            Object(next)['focus']?.call(next);
          }}
        >
          <ToggleGroupItem {...boldState}>
            <ToggleGroupButton
              {...boldState}
              aria-pressed={String(state.value === 'bold' || state.value === 'bold,italic')}
              data-state={
                state.value === 'bold' || state.value === 'bold,italic' ? 'pressed' : 'off'
              }
              id="gallery-toggle-group-bold"
              onClick={() => {
                const result = _toggleGroupItemClick(Object(event), {
                  itemValue: 'bold',
                  items: [
                    { value: 'bold' },
                    { disabled: true, value: 'strike' },
                    { value: 'italic' },
                  ],
                  type: 'multiple',
                  value:
                    state.value === 'bold,italic'
                      ? ['bold', 'italic']
                      : state.value === ''
                        ? []
                        : [state.value],
                });
                if (!result) return;
                state.activeValue = 'bold';
                state.value = result.value?.toString() ?? '';
              }}
              tabIndex={state.activeValue === 'bold' ? 0 : -1}
            >
              Bold
            </ToggleGroupButton>
          </ToggleGroupItem>
          <ToggleGroupItem {...strikeState}>
            <ToggleGroupButton
              {...strikeState}
              data-state="off"
              id="gallery-toggle-group-strike"
              itemDisabled={true}
              tabIndex={-1}
            >
              Strike
            </ToggleGroupButton>
          </ToggleGroupItem>
          <ToggleGroupItem {...italicState}>
            <ToggleGroupButton
              {...italicState}
              aria-pressed={String(state.value === 'italic' || state.value === 'bold,italic')}
              data-state={
                state.value === 'italic' || state.value === 'bold,italic' ? 'pressed' : 'off'
              }
              id="gallery-toggle-group-italic"
              onClick={() => {
                const result = _toggleGroupItemClick(Object(event), {
                  itemValue: 'italic',
                  items: [
                    { value: 'bold' },
                    { disabled: true, value: 'strike' },
                    { value: 'italic' },
                  ],
                  type: 'multiple',
                  value:
                    state.value === 'bold,italic'
                      ? ['bold', 'italic']
                      : state.value === ''
                        ? []
                        : [state.value],
                });
                if (!result) return;
                state.activeValue = 'italic';
                state.value = result.value?.toString() ?? '';
              }}
              tabIndex={state.activeValue === 'italic' ? 0 : -1}
            >
              Italic
            </ToggleGroupButton>
          </ToggleGroupItem>
        </ToggleGroup>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="toggle-group-value"
        >
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
