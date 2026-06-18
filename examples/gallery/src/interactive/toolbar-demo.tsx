/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarKeyDown as _toolbarKeyDown,
  toolbarRootAttributes,
} from '@kovojs/headless-ui/toolbar';
import {
  toolbarClasses,
  toolbarItemClasses,
  toolbarButtonClasses,
} from '@kovojs/ui/toolbar';

const TOOLBAR_CLASS = toolbarClasses.join(' ');
const ITEM_CLASS = toolbarItemClasses.join(' ');
const BUTTON_CLASS = toolbarButtonClasses.join(' ');

export interface GalleryToolbarDemoState {
  activeValue: string;
  pressedValue: string;
}

const toolbarItems = Object.freeze([
  { value: 'bold' },
  { disabled: true, value: 'italic' },
  { value: 'link' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryToolbarDemo = component({
  state: () => ({ activeValue: 'bold', pressedValue: 'bold' }),
  render: (_queries: Record<string, never>, state: GalleryToolbarDemoState) => {
    const rootState = {
      activeValue: state.activeValue,
      items: toolbarItems,
      label: 'Formatting toolbar',
    };
    const boldState = { ...rootState, itemValue: 'bold' };
    const italicState = { ...rootState, itemValue: 'italic' };
    const linkState = { ...rootState, itemValue: 'link' };

    return (
      <div
        {...toolbarRootAttributes(rootState)}
        class="grid gap-2"
        data-gallery-interactive="toolbar"
        onKeyDown={() => {
          const result = _toolbarKeyDown(Object(event), {
            activeValue: state.activeValue,
            items: [{ value: 'bold' }, { disabled: true, value: 'italic' }, { value: 'link' }],
          });
          if (!result?.value) return;
          state.activeValue = result.value;
          const root = Object(event)['target']?.closest?.('[role="toolbar"]');
          const next = Object(root)?.querySelector?.(`[value="${result.value}"]`);
          Object(next)['focus']?.call(next);
        }}
      >
        <div class={TOOLBAR_CLASS}>
          <span {...toolbarItemAttributes(boldState)} class={ITEM_CLASS}>
            <button
              {...toolbarButtonAttributes({
                ...boldState,
                id: 'gallery-toolbar-bold',
                pressed: state.pressedValue === 'bold',
              })}
              aria-pressed={String(state.pressedValue === 'bold')}
              class={BUTTON_CLASS}
              data-pressed={String(state.pressedValue === 'bold')}
              onClick={() => {
                state.activeValue = 'bold';
                state.pressedValue = state.pressedValue === 'bold' ? '' : 'bold';
              }}
              tabIndex={state.activeValue === 'bold' ? 0 : -1}
            >
              Bold
            </button>
          </span>
          <span {...toolbarItemAttributes(italicState)} class={ITEM_CLASS}>
            <button
              {...toolbarButtonAttributes({
                ...italicState,
                id: 'gallery-toolbar-italic',
                pressed: false,
              })}
              class={BUTTON_CLASS}
              tabIndex={-1}
            >
              Italic
            </button>
          </span>
          <span {...toolbarItemAttributes(linkState)} class={ITEM_CLASS}>
            <button
              {...toolbarButtonAttributes({
                ...linkState,
                id: 'gallery-toolbar-link',
                pressed: state.pressedValue === 'link',
              })}
              aria-pressed={String(state.pressedValue === 'link')}
              class={BUTTON_CLASS}
              data-pressed={String(state.pressedValue === 'link')}
              onClick={() => {
                state.activeValue = 'link';
                state.pressedValue = state.pressedValue === 'link' ? '' : 'link';
              }}
              tabIndex={state.activeValue === 'link' ? 0 : -1}
            >
              Link
            </button>
          </span>
        </div>
        <output data-demo-state="toolbar-active">{state.activeValue}</output>
        <output data-demo-state="toolbar-pressed">{state.pressedValue || 'none'}</output>
      </div>
    );
  },
});
