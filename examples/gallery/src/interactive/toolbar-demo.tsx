/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarKeyDown as _toolbarKeyDown,
  toolbarRootAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/toolbar.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const TOOLBAR_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-1 text-neutral-950 shadow-sm data-[orientation=vertical]:flex-col data-[disabled]:opacity-50';
const ITEM_CLASS = 'inline-flex data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const BUTTON_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded px-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none data-[pressed=true]:bg-neutral-950 data-[pressed=true]:text-white data-[pressed=true]:shadow-sm data-[disabled]:opacity-50';

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
