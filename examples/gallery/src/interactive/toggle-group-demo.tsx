/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/toggle-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
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
// generated artifacts prove the gallery path is compiled through Jiso.
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
          state.activeValue = state.activeValue === 'bold' ? 'italic' : 'bold';
          const doc = Reflect['get'](globalThis, 'document');
          const bold = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-bold')
            : undefined;
          const italic = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-italic')
            : undefined;

          if (bold) bold['tabIndex'] = state.activeValue === 'bold' ? 0 : -1;
          if (italic) italic['tabIndex'] = state.activeValue === 'italic' ? 0 : -1;
          if (state.activeValue === 'bold' && bold) Object(bold)['focus']?.call(bold);
          if (state.activeValue === 'italic' && italic) Object(italic)['focus']?.call(italic);
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
              class={BUTTON_CLASS}
              onClick={() => {
                state.value =
                  state.value === 'bold,italic'
                    ? 'italic'
                    : state.value === 'bold'
                      ? ''
                      : state.value === 'italic'
                        ? 'bold,italic'
                        : 'bold';
                const doc = Reflect['get'](globalThis, 'document');
                const bold = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-bold')
                  : undefined;
                const italic = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-italic')
                  : undefined;
                const output = doc
                  ? Object(doc)['querySelector']?.call(
                      doc,
                      '[data-demo-state="toggle-group-value"]',
                    )
                  : undefined;
                const boldPressed = state.value === 'bold' || state.value === 'bold,italic';
                const italicPressed = state.value === 'italic' || state.value === 'bold,italic';

                if (bold) {
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'aria-pressed',
                    boldPressed ? 'true' : 'false',
                  );
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'data-state',
                    boldPressed ? 'pressed' : 'off',
                  );
                }
                if (italic) {
                  Object(italic)['setAttribute']?.call(
                    italic,
                    'aria-pressed',
                    italicPressed ? 'true' : 'false',
                  );
                  Object(italic)['setAttribute']?.call(
                    italic,
                    'data-state',
                    italicPressed ? 'pressed' : 'off',
                  );
                }
                if (output) output['textContent'] = state.value || 'none';
              }}
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
              class={BUTTON_CLASS}
              onClick={() => {
                state.value =
                  state.value === 'bold,italic'
                    ? 'bold'
                    : state.value === 'italic'
                      ? ''
                      : state.value === 'bold'
                        ? 'bold,italic'
                        : 'italic';
                const doc = Reflect['get'](globalThis, 'document');
                const bold = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-bold')
                  : undefined;
                const italic = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-italic')
                  : undefined;
                const output = doc
                  ? Object(doc)['querySelector']?.call(
                      doc,
                      '[data-demo-state="toggle-group-value"]',
                    )
                  : undefined;
                const boldPressed = state.value === 'bold' || state.value === 'bold,italic';
                const italicPressed = state.value === 'italic' || state.value === 'bold,italic';

                if (bold) {
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'aria-pressed',
                    boldPressed ? 'true' : 'false',
                  );
                  Object(bold)['setAttribute']?.call(
                    bold,
                    'data-state',
                    boldPressed ? 'pressed' : 'off',
                  );
                }
                if (italic) {
                  Object(italic)['setAttribute']?.call(
                    italic,
                    'aria-pressed',
                    italicPressed ? 'true' : 'false',
                  );
                  Object(italic)['setAttribute']?.call(
                    italic,
                    'data-state',
                    italicPressed ? 'pressed' : 'off',
                  );
                }
                if (output) output['textContent'] = state.value || 'none';
              }}
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
