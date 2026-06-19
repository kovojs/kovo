/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  contextMenuFocusElement as _contextMenuFocusElement,
  contextMenuItemClick as _contextMenuItemClick,
  contextMenuItemKeyDown as _contextMenuItemKeyDown,
  contextMenuKeyDown as _contextMenuKeyDown,
  contextMenuMove as _contextMenuMove,
  contextMenuTriggerContextMenu as _contextMenuTriggerContextMenu,
  contextMenuTriggerKeyDown as _contextMenuTriggerKeyDown,
  contextMenuTypeahead as _contextMenuTypeahead,
  type ContextMenuItem as GalleryContextMenuItem,
  type ContextMenuPoint,
} from '@kovojs/headless-ui/context-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@kovojs/ui/context-menu';

export interface GalleryContextMenuDemoState {
  highlightedValue: string;
  open: boolean;
  point: ContextMenuPoint;
  value: string;
}

const contextItems: readonly GalleryContextMenuItem[] = Object.freeze([
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
      <ContextMenu
        {...menuState}
        data-gallery-interactive="context-menu"
        data-state={state.open ? 'open' : 'closed'}
      >
        <ContextMenuTrigger
          {...menuState}
          aria-expanded={state.open ? 'true' : 'false'}
          contentId={contentId}
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
        </ContextMenuTrigger>
        <ContextMenuContent
          {...menuState}
          data-anchor-x={String(state.point.x)}
          data-anchor-y={String(state.point.y)}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          id={contentId}
        >
          <ContextMenuItem
            {...menuState}
            data-highlighted={state.highlightedValue === 'copy' ? '' : null}
            data-state={state.highlightedValue === 'copy' ? 'active' : 'inactive'}
            id="gallery-context-menu-copy"
            itemLabel="Copy link"
            itemValue="copy"
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
            tabIndex={state.highlightedValue === 'copy' ? 0 : -1}
          >
            Copy link
          </ContextMenuItem>
          <ContextMenuItem
            {...menuState}
            id="gallery-context-menu-delete"
            itemDisabled={true}
            itemLabel="Delete"
            itemValue="delete"
          >
            Delete
          </ContextMenuItem>
          <ContextMenuItem
            {...menuState}
            data-highlighted={state.highlightedValue === 'inspect' ? '' : null}
            data-state={state.highlightedValue === 'inspect' ? 'active' : 'inactive'}
            id="gallery-context-menu-inspect"
            itemLabel="Inspect"
            itemValue="inspect"
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
            tabIndex={state.highlightedValue === 'inspect' ? 0 : -1}
          >
            Inspect
          </ContextMenuItem>
        </ContextMenuContent>
        <output data-demo-state="context-open">{state.open ? 'open' : 'closed'}</output>
        <output data-demo-state="context-value">{state.value}</output>
      </ContextMenu>
    );
  },
});
