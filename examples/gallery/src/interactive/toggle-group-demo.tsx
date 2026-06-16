/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupItemClick as _toggleGroupItemClick,
  toggleGroupKeyDown as _toggleGroupKeyDown,
  toggleGroupRootAttributes,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/toggle-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const GROUP_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-100 p-1 text-neutral-950 data-[orientation=vertical]:flex-col data-[disabled]:opacity-50';
const ITEM_CLASS = 'inline-flex data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const BUTTON_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded px-2.5 text-sm font-medium text-neutral-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[state=pressed]:bg-white data-[state=pressed]:text-neutral-950 data-[state=pressed]:shadow-sm data-[disabled]:opacity-50';

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
export const GalleryToggleGroupDemo = component('gallery-toggle-group-demo', {
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
        {...toggleGroupRootAttributes({
          ...groupState,
          labelledBy: 'gallery-toggle-group-label',
        })}
        class="grid gap-2 text-sm text-neutral-950"
        data-gallery-interactive="toggle-group"
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
        <h3 id="gallery-toggle-group-label" class="text-sm font-medium">
          Text style
        </h3>
        <div class={GROUP_CLASS}>
          <span {...toggleGroupItemAttributes(boldState)} class={ITEM_CLASS}>
            <button
              {...toggleGroupButtonAttributes({
                ...boldState,
                id: 'gallery-toggle-group-bold',
              })}
              aria-pressed={String(state.value === 'bold' || state.value === 'bold,italic')}
              class={BUTTON_CLASS}
              data-state={
                state.value === 'bold' || state.value === 'bold,italic' ? 'pressed' : 'off'
              }
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
            </button>
          </span>
          <span {...toggleGroupItemAttributes(strikeState)} class={ITEM_CLASS}>
            <button
              {...toggleGroupButtonAttributes({
                ...strikeState,
                id: 'gallery-toggle-group-strike',
              })}
              class={BUTTON_CLASS}
              data-state="off"
              tabIndex={-1}
            >
              Strike
            </button>
          </span>
          <span {...toggleGroupItemAttributes(italicState)} class={ITEM_CLASS}>
            <button
              {...toggleGroupButtonAttributes({
                ...italicState,
                id: 'gallery-toggle-group-italic',
              })}
              aria-pressed={String(state.value === 'italic' || state.value === 'bold,italic')}
              class={BUTTON_CLASS}
              data-state={
                state.value === 'italic' || state.value === 'bold,italic' ? 'pressed' : 'off'
              }
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
            </button>
          </span>
        </div>
        <output class="text-xs text-neutral-500" data-demo-state="toggle-group-value">
          {state.value || 'none'}
        </output>
      </section>
    );
  },
});
