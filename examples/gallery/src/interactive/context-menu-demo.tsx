/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  contextMenuContentAttributes,
  contextMenuFocusElement as _contextMenuFocusElement,
  contextMenuItemAttributes,
  contextMenuItemClick as _contextMenuItemClick,
  contextMenuItemKeyDown as _contextMenuItemKeyDown,
  contextMenuKeyDown as _contextMenuKeyDown,
  contextMenuMove as _contextMenuMove,
  contextMenuRootAttributes,
  contextMenuTriggerAttributes,
  contextMenuTriggerContextMenu as _contextMenuTriggerContextMenu,
  contextMenuTriggerKeyDown as _contextMenuTriggerKeyDown,
  contextMenuTypeahead as _contextMenuTypeahead,
  type ContextMenuItem,
  type ContextMenuPoint,
} from '@kovojs/headless-ui/context-menu';
import {
  contextMenuTriggerClasses,
  contextMenuContentClasses,
  contextMenuItemClasses,
} from '@kovojs/ui/context-menu';

const TRIGGER_CLASS = contextMenuTriggerClasses.join(' ');
const CONTENT_CLASS = contextMenuContentClasses.join(' ');
const ITEM_CLASS = contextMenuItemClasses.join(' ');

export interface GalleryContextMenuDemoState {
  highlightedValue: string;
  open: boolean;
  point: ContextMenuPoint;
  value: string;
}

const contextItems: readonly ContextMenuItem[] = Object.freeze([
  { label: 'Copy link', value: 'copy' },
  { disabled: true, label: 'Delete', value: 'delete' },
  { label: 'Inspect', value: 'inspect' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryContextMenuDemo = component({
  state: () => ({ highlightedValue: 'copy', open: false, point: { x: 24, y: 40 }, value: 'copy' }),
  render: (_queries: Record<string, never>, state: GalleryContextMenuDemoState) => {
    const contentId = 'gallery-context-menu-content';
    const menuState = {
      highlightedValue: state.highlightedValue,
      items: contextItems,
      open: state.open,
      point: state.point,
    };

    return (
      <section
        {...contextMenuRootAttributes(menuState)}
        class="grid gap-2"
        data-gallery-interactive="context-menu"
        data-state={state.open ? 'open' : 'closed'}
      >
        <div
          {...contextMenuTriggerAttributes({ ...menuState, contentId })}
          aria-expanded={state.open ? 'true' : 'false'}
          class={TRIGGER_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          id="gallery-context-menu-trigger"
          onContextMenu={() => {
            const result = _contextMenuTriggerContextMenu(Object(event), {
              highlightedValue: state.highlightedValue,
              items: [
                { label: 'Copy link', value: 'copy' },
                { disabled: true, label: 'Delete', value: 'delete' },
                { label: 'Inspect', value: 'inspect' },
              ],
              open: state.open,
              point: state.point,
            });
            if (!result?.changed) return;
            state.open = result.open;
            state.point = result.point ?? state.point;
            state.highlightedValue = 'copy';
            if (result.open)
              _contextMenuFocusElement(Object(event), 'gallery-context-menu-copy', { defer: true });
          }}
          onKeyDown={() => {
            const result = _contextMenuTriggerKeyDown(Object(event), {
              highlightedValue: state.highlightedValue,
              items: [
                { label: 'Copy link', value: 'copy' },
                { disabled: true, label: 'Delete', value: 'delete' },
                { label: 'Inspect', value: 'inspect' },
              ],
              open: state.open,
              point: state.point,
            });
            if (!result?.changed) return;
            state.open = result.open;
            state.point = result.point ?? state.point;
            state.highlightedValue = 'copy';
            if (result.open)
              _contextMenuFocusElement(Object(event), 'gallery-context-menu-copy', { defer: true });
          }}
          tabIndex="0"
        >
          Right click target
        </div>
        <div
          {...contextMenuContentAttributes({ ...menuState, id: contentId })}
          class={CONTENT_CLASS}
          data-anchor-x={String(state.point.x)}
          data-anchor-y={String(state.point.y)}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
        >
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-copy',
              itemLabel: 'Copy link',
              itemValue: 'copy',
            })}
            class={ITEM_CLASS}
            data-highlighted={state.highlightedValue === 'copy' ? '' : null}
            data-state={state.highlightedValue === 'copy' ? 'active' : 'inactive'}
            tabIndex={state.highlightedValue === 'copy' ? 0 : -1}
            onKeyDown={() => {
              const result = _contextMenuItemKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'copy',
                items: [
                  { label: 'Copy link', value: 'copy' },
                  { disabled: true, label: 'Delete', value: 'delete' },
                  { label: 'Inspect', value: 'inspect' },
                ],
                open: state.open,
                point: state.point,
              });
              if (result?.selected) {
                state.open = result.open.open;
                state.highlightedValue = result.value;
                state.value = result.value;
                _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
                return;
              }

              const keyResult = _contextMenuKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Copy link', value: 'copy' },
                  { disabled: true, label: 'Delete', value: 'delete' },
                  { label: 'Inspect', value: 'inspect' },
                ],
                open: state.open,
                point: state.point,
              });
              if (keyResult?.changed) {
                state.open = keyResult.open;
                if (!keyResult.open)
                  _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
                return;
              }

              const move = _contextMenuMove(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Copy link', value: 'copy' },
                    { disabled: true, label: 'Delete', value: 'delete' },
                    { label: 'Inspect', value: 'inspect' },
                  ],
                  open: state.open,
                  point: state.point,
                },
                Object(event).key,
                { loop: true },
              );
              if (move) {
                Object(event).preventDefault?.();
                state.highlightedValue = move.highlightedValue ?? state.highlightedValue;
                _contextMenuFocusElement(
                  Object(event),
                  state.highlightedValue === 'inspect'
                    ? 'gallery-context-menu-inspect'
                    : 'gallery-context-menu-copy',
                );
                return;
              }

              const typeahead = _contextMenuTypeahead(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Copy link', value: 'copy' },
                    { disabled: true, label: 'Delete', value: 'delete' },
                    { label: 'Inspect', value: 'inspect' },
                  ],
                  open: state.open,
                  point: state.point,
                },
                Object(event).key,
                { now: 0, loop: true },
              );
              if (typeahead.highlightedValue === state.highlightedValue) return;
              Object(event).preventDefault?.();
              state.highlightedValue = typeahead.highlightedValue ?? state.highlightedValue;
              _contextMenuFocusElement(
                Object(event),
                state.highlightedValue === 'inspect'
                  ? 'gallery-context-menu-inspect'
                  : 'gallery-context-menu-copy',
              );
            }}
            onClick={() => {
              const result = _contextMenuItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'copy',
                items: [
                  { label: 'Copy link', value: 'copy' },
                  { disabled: true, label: 'Delete', value: 'delete' },
                  { label: 'Inspect', value: 'inspect' },
                ],
                open: state.open,
                point: state.point,
              });
              if (!result?.selected) return;
              state.open = result.open.open;
              state.highlightedValue = result.value;
              state.value = result.value;
              _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
            }}
          >
            Copy link
          </button>
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-delete',
              itemDisabled: true,
              itemLabel: 'Delete',
              itemValue: 'delete',
            })}
            class={ITEM_CLASS}
          >
            Delete
          </button>
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-inspect',
              itemLabel: 'Inspect',
              itemValue: 'inspect',
            })}
            class={ITEM_CLASS}
            data-highlighted={state.highlightedValue === 'inspect' ? '' : null}
            data-state={state.highlightedValue === 'inspect' ? 'active' : 'inactive'}
            tabIndex={state.highlightedValue === 'inspect' ? 0 : -1}
            onKeyDown={() => {
              const result = _contextMenuItemKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'inspect',
                items: [
                  { label: 'Copy link', value: 'copy' },
                  { disabled: true, label: 'Delete', value: 'delete' },
                  { label: 'Inspect', value: 'inspect' },
                ],
                open: state.open,
                point: state.point,
              });
              if (result?.selected) {
                state.open = result.open.open;
                state.highlightedValue = result.value;
                state.value = result.value;
                _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
                return;
              }

              const keyResult = _contextMenuKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Copy link', value: 'copy' },
                  { disabled: true, label: 'Delete', value: 'delete' },
                  { label: 'Inspect', value: 'inspect' },
                ],
                open: state.open,
                point: state.point,
              });
              if (keyResult?.changed) {
                state.open = keyResult.open;
                if (!keyResult.open)
                  _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
                return;
              }

              const move = _contextMenuMove(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Copy link', value: 'copy' },
                    { disabled: true, label: 'Delete', value: 'delete' },
                    { label: 'Inspect', value: 'inspect' },
                  ],
                  open: state.open,
                  point: state.point,
                },
                Object(event).key,
                { loop: true },
              );
              if (move) {
                Object(event).preventDefault?.();
                state.highlightedValue = move.highlightedValue ?? state.highlightedValue;
                _contextMenuFocusElement(
                  Object(event),
                  state.highlightedValue === 'inspect'
                    ? 'gallery-context-menu-inspect'
                    : 'gallery-context-menu-copy',
                );
                return;
              }

              const typeahead = _contextMenuTypeahead(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Copy link', value: 'copy' },
                    { disabled: true, label: 'Delete', value: 'delete' },
                    { label: 'Inspect', value: 'inspect' },
                  ],
                  open: state.open,
                  point: state.point,
                },
                Object(event).key,
                { now: 0, loop: true },
              );
              if (typeahead.highlightedValue === state.highlightedValue) return;
              Object(event).preventDefault?.();
              state.highlightedValue = typeahead.highlightedValue ?? state.highlightedValue;
              _contextMenuFocusElement(
                Object(event),
                state.highlightedValue === 'inspect'
                  ? 'gallery-context-menu-inspect'
                  : 'gallery-context-menu-copy',
              );
            }}
            onClick={() => {
              const result = _contextMenuItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'inspect',
                items: [
                  { label: 'Copy link', value: 'copy' },
                  { disabled: true, label: 'Delete', value: 'delete' },
                  { label: 'Inspect', value: 'inspect' },
                ],
                open: state.open,
                point: state.point,
              });
              if (!result?.selected) return;
              state.open = result.open.open;
              state.highlightedValue = result.value;
              state.value = result.value;
              _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
            }}
          >
            Inspect
          </button>
        </div>
        <output data-demo-state="context-open">{state.open ? 'open' : 'closed'}</output>
        <output data-demo-state="context-value">{state.value}</output>
      </section>
    );
  },
});
