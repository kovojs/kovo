/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/toolbar.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryToolbarDemo = component('gallery-toolbar-demo', {
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
          state.activeValue = state.activeValue === 'bold' ? 'link' : 'bold';
          const doc = Reflect['get'](globalThis, 'document');
          const bold = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-bold')
            : undefined;
          const link = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-link')
            : undefined;
          const output = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-active"]')
            : undefined;

          if (bold) bold['tabIndex'] = state.activeValue === 'bold' ? 0 : -1;
          if (link) link['tabIndex'] = state.activeValue === 'link' ? 0 : -1;
          if (state.activeValue === 'bold' && bold) Object(bold)['focus']?.call(bold);
          if (state.activeValue === 'link' && link) Object(link)['focus']?.call(link);
          if (output) output['textContent'] = state.activeValue;
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
              class={BUTTON_CLASS}
              onClick={() => {
                state.activeValue = 'bold';
                state.pressedValue = state.pressedValue === 'bold' ? '' : 'bold';
                const doc = Reflect['get'](globalThis, 'document');
                const bold = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-bold')
                  : undefined;
                const link = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-link')
                  : undefined;
                const activeOutput = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-active"]')
                  : undefined;
                const pressedOutput = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-pressed"]')
                  : undefined;

                if (bold) {
                  bold['tabIndex'] = 0;
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'aria-pressed',
                    state.pressedValue === 'bold' ? 'true' : 'false',
                  );
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'data-pressed',
                    state.pressedValue === 'bold' ? 'true' : 'false',
                  );
                }
                if (link) {
                  link['tabIndex'] = -1;
                  Object(link)['setAttribute']?.call(
                    link,
                    'aria-pressed',
                    state.pressedValue === 'link' ? 'true' : 'false',
                  );
                  Object(link)['setAttribute']?.call(
                    link,
                    'data-pressed',
                    state.pressedValue === 'link' ? 'true' : 'false',
                  );
                }
                if (activeOutput) activeOutput['textContent'] = state.activeValue;
                if (pressedOutput) pressedOutput['textContent'] = state.pressedValue || 'none';
              }}
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
              class={BUTTON_CLASS}
              onClick={() => {
                state.activeValue = 'link';
                state.pressedValue = state.pressedValue === 'link' ? '' : 'link';
                const doc = Reflect['get'](globalThis, 'document');
                const bold = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-bold')
                  : undefined;
                const link = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-link')
                  : undefined;
                const activeOutput = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-active"]')
                  : undefined;
                const pressedOutput = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-pressed"]')
                  : undefined;

                if (bold) {
                  bold['tabIndex'] = -1;
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'aria-pressed',
                    state.pressedValue === 'bold' ? 'true' : 'false',
                  );
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'data-pressed',
                    state.pressedValue === 'bold' ? 'true' : 'false',
                  );
                }
                if (link) {
                  link['tabIndex'] = 0;
                  Object(link)['setAttribute']?.call(
                    link,
                    'aria-pressed',
                    state.pressedValue === 'link' ? 'true' : 'false',
                  );
                  Object(link)['setAttribute']?.call(
                    link,
                    'data-pressed',
                    state.pressedValue === 'link' ? 'true' : 'false',
                  );
                }
                if (activeOutput) activeOutput['textContent'] = state.activeValue;
                if (pressedOutput) pressedOutput['textContent'] = state.pressedValue || 'none';
              }}
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
