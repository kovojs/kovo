/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  Toolbar,
  ToolbarButton,
  ToolbarItem,
  toolbarKeyDown as _toolbarKeyDown,
} from '@kovojs/ui/toolbar';

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
      <div style="display:grid;gap:0.5rem" data-gallery-interactive="toolbar">
        <Toolbar
          {...rootState}
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
          <ToolbarItem {...boldState}>
            <ToolbarButton
              {...boldState}
              aria-pressed={String(state.pressedValue === 'bold')}
              data-pressed={String(state.pressedValue === 'bold')}
              id="gallery-toolbar-bold"
              onClick={() => {
                state.activeValue = 'bold';
                state.pressedValue = state.pressedValue === 'bold' ? '' : 'bold';
              }}
              pressed={state.pressedValue === 'bold'}
              tabIndex={state.activeValue === 'bold' ? 0 : -1}
            >
              Bold
            </ToolbarButton>
          </ToolbarItem>
          <ToolbarItem {...italicState}>
            <ToolbarButton
              {...italicState}
              id="gallery-toolbar-italic"
              pressed={false}
              tabIndex={-1}
            >
              Italic
            </ToolbarButton>
          </ToolbarItem>
          <ToolbarItem {...linkState}>
            <ToolbarButton
              {...linkState}
              aria-pressed={String(state.pressedValue === 'link')}
              data-pressed={String(state.pressedValue === 'link')}
              id="gallery-toolbar-link"
              onClick={() => {
                state.activeValue = 'link';
                state.pressedValue = state.pressedValue === 'link' ? '' : 'link';
              }}
              pressed={state.pressedValue === 'link'}
              tabIndex={state.activeValue === 'link' ? 0 : -1}
            >
              Link
            </ToolbarButton>
          </ToolbarItem>
        </Toolbar>
        <output data-demo-state="toolbar-active">{state.activeValue}</output>
        <output data-demo-state="toolbar-pressed">{state.pressedValue || 'none'}</output>
      </div>
    );
  },
});
