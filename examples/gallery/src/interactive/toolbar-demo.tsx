/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toolbarButtonAttributes,
  toolbarItemAttributes,
  toolbarRootAttributes,
} from '@jiso/headless-ui/primitives';

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
        <div class="inline-flex gap-1">
          <span {...toolbarItemAttributes(boldState)}>
            <button
              {...toolbarButtonAttributes({
                ...boldState,
                id: 'gallery-toolbar-bold',
                pressed: state.pressedValue === 'bold',
              })}
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
          <span {...toolbarItemAttributes(italicState)}>
            <button
              {...toolbarButtonAttributes({
                ...italicState,
                id: 'gallery-toolbar-italic',
                pressed: false,
              })}
            >
              Italic
            </button>
          </span>
          <span {...toolbarItemAttributes(linkState)}>
            <button
              {...toolbarButtonAttributes({
                ...linkState,
                id: 'gallery-toolbar-link',
                pressed: state.pressedValue === 'link',
              })}
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
