import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';
import {
  Command,
  CommandClose,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandListbox,
  CommandTrigger,
  CommandValue,
} from './command.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './context-menu.js';
import { Drawer } from './drawer.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { Menubar, MenubarItem, MenubarSubmenu } from './menubar.js';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from './navigation-menu.js';
import { Sheet } from './sheet.js';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from './toast.js';
describe('@kovojs/ui styled package foundation', () => {
  it('wraps the headless toast primitive as styled live-region markup', () => {
    const toast = String(
      renderUiComponent(Toast, {
        children: `${renderUiComponent(ToastTitle, {
          children: 'Deployment complete',
          id: 'deploy-toast-title',
        })}${renderUiComponent(ToastDescription, {
          children: 'Production is serving the new build.',
          id: 'deploy-toast-description',
        })}${renderUiComponent(ToastAction, {
          actionValue: 'open-deploy',
          children: 'View',
          id: 'deploy-toast',
          variant: 'success',
        })}${renderUiComponent(ToastAction, {
          actionValue: 'keep-open',
          children: 'Keep open',
          dismissOnAction: false,
          id: 'deploy-toast',
          variant: 'success',
        })}${renderUiComponent(ToastAction, {
          actionValue: 'blocked',
          children: 'Blocked',
          disabled: true,
          dismissOnAction: false,
          id: 'deploy-toast',
          variant: 'success',
        })}${renderUiComponent(ToastClose, {
          children: 'Dismiss',
          id: 'deploy-toast',
          variant: 'success',
        })}`,
        descriptionId: 'deploy-toast-description',
        id: 'deploy-toast',
        titleId: 'deploy-toast-title',
        variant: 'success',
      }),
    );
    const viewport = String(
      renderUiComponent(ToastViewport, {
        children: toast,
        id: 'toast-viewport',
        label: 'Build notifications',
        placement: 'top-center',
      }),
    );
    const hiddenToast = String(renderUiComponent(Toast, { id: 'hidden-toast', open: false }));
    expect(viewport).toContain('aria-label="Build notifications"');
    expect(viewport).toContain('data-placement="top-center" id="toast-viewport"');
    expect(viewport).toContain('role="region" tabIndex="-1"');
    expect(viewport).toContain('aria-atomic="true"');
    expect(viewport).toContain('aria-live="polite"');
    expect(viewport).toContain('aria-describedby="deploy-toast-description"');
    expect(viewport).toContain('aria-labelledby="deploy-toast-title"');
    expect(viewport).toContain('data-state="open" data-variant="success"');
    expect(viewport).toContain('role="status"');
    expect(viewport).toContain('data-part="title" id="deploy-toast-title"');
    expect(viewport).toContain('data-part="description" id="deploy-toast-description"');
    expect(viewport).toContain('data-action=""');
    expect(viewport).toContain('data-action="" data-state="open" data-variant="success"');
    expect(viewport).toContain('data-dismiss-on-action="false"');
    expect(viewport).toContain('type="button" value="open-deploy"');
    expect(viewport).toContain('type="button" value="keep-open"');
    expect(viewport).toContain('data-disabled=""');
    expect(viewport).toContain('disabled type="button" value="blocked"');
    expect(viewport).toContain('data-dismiss="" data-state="open" data-variant="success"');
    expect(hiddenToast).toContain('data-state="closed"');
    expect(hiddenToast).toContain('hidden id="hidden-toast"');
  });
  it('wraps H3 menu primitives as styled menu surfaces', () => {
    const dropdownItems = [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ];
    const dropdownState = {
      highlightedValue: 'rename',
      items: dropdownItems,
      open: true,
    };
    const dropdown = String(
      renderUiComponent(DropdownMenu, {
        ...dropdownState,
        children: `${renderUiComponent(DropdownMenuTrigger, {
          ...dropdownState,
          contentId: 'file-actions-menu',
          id: 'file-actions-trigger',
        })}${renderUiComponent(DropdownMenuContent, {
          ...dropdownState,
          children: dropdownItems
            .map((item) =>
              renderUiComponent(DropdownMenuItem, {
                ...dropdownState,
                ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
                itemLabel: item.label,
                itemValue: item.value,
              }),
            )
            .join(''),
          id: 'file-actions-menu',
        })}`,
        id: 'file-actions',
      }),
    );
    const context = String(
      renderUiComponent(ContextMenu, {
        children: `${renderUiComponent(ContextMenuTrigger, {
          contentId: 'row-menu',
          id: 'row-trigger',
          open: true,
        })}${renderUiComponent(ContextMenuContent, {
          children: `${renderUiComponent(ContextMenuItem, {
            highlightedValue: 'inspect',
            itemLabel: 'Inspect',
            itemValue: 'inspect',
            open: true,
          })}${renderUiComponent(ContextMenuItem, {
            highlightedValue: 'inspect',
            itemDisabled: true,
            itemLabel: 'Delete',
            itemValue: 'delete',
            open: true,
          })}`,
          id: 'row-menu',
          open: true,
          point: { x: 24, y: 32 },
        })}`,
        open: true,
      }),
    );
    expect(dropdown).toContain('aria-controls="file-actions-menu"');
    expect(dropdown).toContain('aria-expanded="true"');
    expect(dropdown).toContain('aria-haspopup="menu"');
    expect(dropdown).toContain('role="menu" tabIndex="-1"');
    expect(dropdown).toContain('data-highlighted="" data-state="active" role="menuitem"');
    expect(dropdown).toContain('tabIndex="0" type="button" value="rename"');
    expect(dropdown).toContain('data-disabled="" data-state="inactive"');
    expect(dropdown).toContain('aria-disabled="true"');
    expect(dropdown).toContain(
      'disabled role="menuitem" tabIndex="-1" type="button" value="archive"',
    );
    expect(context).toContain('kovo-context-menu="row-menu"');
    expect(context).toContain('aria-haspopup="menu"');
    expect(context).toContain('data-anchor-x="24" data-anchor-y="32"');
    expect(context).toContain('role="menu" tabIndex="-1"');
    expect(context).toContain('data-highlighted="" data-state="active"');
    expect(context).toContain('aria-disabled="true"');
    expect(context).toContain(
      'disabled role="menuitem" tabIndex="-1" type="button" value="delete"',
    );
  });
  it('wraps menubar and navigation-menu primitives as styled roving navigation', () => {
    const menubarItems = [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ];
    const menubar = String(
      renderUiComponent(Menubar, {
        activeValue: 'file',
        children: `${renderUiComponent(MenubarItem, {
          activeValue: 'file',
          contentId: 'file-menu',
          itemLabel: 'File',
          itemValue: 'file',
          items: menubarItems,
          openValue: 'file',
        })}${renderUiComponent(MenubarItem, {
          activeValue: 'file',
          itemLabel: 'Edit',
          itemValue: 'edit',
          items: menubarItems,
          openValue: 'file',
        })}${renderUiComponent(MenubarSubmenu, {
          children: `${renderUiComponent(MenubarItem, {
            activeValue: 'new',
            itemLabel: 'New',
            itemParentValue: 'file',
            itemValue: 'new',
            items: menubarItems,
            openValue: 'file',
          })}${renderUiComponent(MenubarItem, {
            activeValue: 'new',
            itemDisabled: true,
            itemLabel: 'Import',
            itemParentValue: 'file',
            itemValue: 'import',
            items: menubarItems,
            openValue: 'file',
          })}`,
          id: 'file-menu',
          labelledBy: 'file-item',
          openValue: 'file',
          value: 'file',
        })}`,
        items: menubarItems,
        label: 'Document commands',
        openValue: 'file',
      }),
    );
    const navItems = [
      { hasContent: true, label: 'Products', value: 'products' },
      { label: 'Docs', value: 'docs' },
    ];
    const navigation = String(
      renderUiComponent(NavigationMenu, {
        activeValue: 'products',
        children: `${renderUiComponent(NavigationMenuList, {
          activeValue: 'products',
          children: `${renderUiComponent(NavigationMenuItem, {
            activeValue: 'products',
            children: renderUiComponent(NavigationMenuTrigger, {
              activeValue: 'products',
              contentId: 'products-panel',
              itemLabel: 'Products',
              itemValue: 'products',
              items: navItems,
              openValue: 'products',
            }),
            itemValue: 'products',
            items: navItems,
            openValue: 'products',
          })}${renderUiComponent(NavigationMenuItem, {
            activeValue: 'products',
            children: renderUiComponent(NavigationMenuLink, {
              activeValue: 'products',
              href: '/docs',
              itemLabel: 'Docs',
              itemValue: 'docs',
              items: navItems,
              openValue: 'products',
            }),
            itemValue: 'docs',
            items: navItems,
            openValue: 'products',
          })}`,
          items: navItems,
          openValue: 'products',
        })}${renderUiComponent(NavigationMenuContent, {
          children: 'Product links',
          id: 'products-panel',
          openValue: 'products',
          value: 'products',
        })}${renderUiComponent(NavigationMenuViewport, {
          id: 'products-viewport',
          openValue: 'products',
        })}`,
        items: navItems,
        label: 'Primary',
        openValue: 'products',
      }),
    );
    expect(menubar).toContain('aria-label="Document commands"');
    expect(menubar).toContain('role="menubar"');
    expect(menubar).toContain('aria-controls="file-menu"');
    expect(menubar).toContain('aria-expanded="true"');
    expect(menubar).toContain('data-highlighted="" data-state="active"');
    expect(menubar).toContain('role="menu" tabIndex="-1"');
    expect(menubar).toContain('tabIndex="0" type="button" value="file"');
    expect(menubar).toContain('aria-disabled="true"');
    expect(menubar).toContain(
      'disabled role="menuitem" tabIndex="-1" type="button" value="import"',
    );
    expect(navigation).toContain('aria-label="Primary"');
    expect(navigation).toContain('data-state="open"');
    expect(navigation).toContain('role="navigation"');
    expect(navigation).toContain('data-state="open" role="list"');
    expect(navigation).toContain('role="listitem"');
    expect(navigation).toContain('aria-controls="products-panel"');
    expect(navigation).toContain('aria-expanded="true"');
    expect(navigation).toContain('href="/docs"');
    expect(navigation).toContain('role="group" tabIndex="-1"');
    expect(navigation).toContain('id="products-viewport"');
  });
  it('wraps command primitive as a styled native dialog combobox', () => {
    const items = [
      { label: 'Open dashboard', value: 'dashboard' },
      { label: 'Invite teammate', value: 'invite' },
      { disabled: true, label: 'Delete project', value: 'delete' },
    ];
    const state = {
      form: 'command-form',
      highlightedValue: 'invite',
      inputValue: '',
      invalid: true,
      items,
      name: 'command-query',
      open: true,
      placeholder: 'Type a command',
      required: true,
      value: 'invite',
    };
    const command = String(
      renderUiComponent(Command, {
        ...state,
        children:
          renderUiComponent(CommandTrigger, {
            ...state,
            contentId: 'command-dialog',
            id: 'command-trigger',
          }) +
          renderUiComponent(CommandDialog, {
            ...state,
            children:
              renderUiComponent(CommandInput, {
                ...state,
                id: 'command-input',
                labelledBy: 'command-title',
                listboxId: 'command-listbox',
              }) +
              renderUiComponent(CommandListbox, {
                ...state,
                children: items.reduce(
                  (html, item) =>
                    html +
                    renderUiComponent(CommandItem, {
                      ...state,
                      ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
                      itemLabel: item.label,
                      itemValue: item.value,
                      listboxId: 'command-listbox',
                    }),
                  '',
                ),
                id: 'command-listbox',
                labelledBy: 'command-title',
              }) +
              renderUiComponent(CommandEmpty, {
                inputValue: 'zzz',
                items,
              }) +
              renderUiComponent(CommandClose, {
                ...state,
                contentId: 'command-dialog',
              }) +
              renderUiComponent(CommandValue, {
                ...state,
                id: 'command-value',
              }),
            contentId: 'command-dialog',
            descriptionId: 'command-description',
            titleId: 'command-title',
          }),
        id: 'command-root',
      }),
    );
    expect(command).toContain('command="show-modal" commandfor="command-dialog"');
    expect(command).toContain('aria-modal="true"');
    expect(command).toContain('id="command-dialog" open');
    expect(command).toContain('form="command-form" id="command-input" name="command-query"');
    expect(command).toContain('aria-invalid="true"');
    expect(command).toContain('required role="combobox" type="text" value=""');
    expect(command).toContain('aria-activedescendant="command-listbox-item-1"');
    expect(command).toContain('role="listbox"');
    expect(command).toContain('aria-selected="true"');
    expect(command).toContain('data-highlighted="" data-state="active"');
    expect(command).toContain('aria-disabled="true"');
    expect(command).toContain('aria-disabled="true"');
    expect(command).toContain('data-disabled="" data-state="inactive" disabled');
    expect(command).toMatch(
      /id="command-[^"]+-item-2" role="option" tabIndex="-1" type="button" value="delete"/,
    );
    expect(command).toContain('command="request-close" commandfor="command-dialog"');
    expect(command).toContain('id="command-value">Invite teammate</span>');
  });
  it('wraps the headless dialog primitive for a bounded sheet component', () => {
    const rendered = String(
      renderUiComponent(Sheet, {
        children: 'Sheet body',
        contentId: 'account-sheet',
        description: 'Manage account settings',
        open: true,
        side: 'left',
        title: 'Account',
        trigger: 'Settings',
      }),
    );
    expect(rendered).toContain('aria-controls="account-sheet"');
    expect(rendered).toContain('command="show-modal" commandfor="account-sheet"');
    expect(rendered).toContain('<dialog class=');
    expect(rendered).toContain('aria-describedby="account-sheet-description"');
    expect(rendered).toContain('aria-modal="true"');
    expect(rendered).toContain('closedby="any"');
    expect(rendered).toContain('id="account-sheet" open role="dialog"');
    expect(rendered).toContain('data-style-src="sheet.tsx#content; sheet.tsx#left"');
    expect(rendered).toContain('command="request-close" commandfor="account-sheet"');
    const topSheet = String(
      renderUiComponent(Sheet, {
        contentId: 'top-sheet',
        side: 'top',
        title: 'Top sheet',
      }),
    );
    const drawer = String(
      renderUiComponent(Drawer, {
        children: 'Drawer body',
        contentId: 'account-drawer',
        description: 'Mobile actions',
        open: true,
        title: 'Actions',
        trigger: 'Open drawer',
      }),
    );
    expect(topSheet).toContain('data-style-src="sheet.tsx#content; sheet.tsx#top"');
    expect(drawer).toContain('command="show-modal" commandfor="account-drawer"');
    expect(drawer).toContain('<dialog class=');
    expect(drawer).toContain('aria-describedby="account-drawer-description"');
    expect(drawer).toContain('aria-modal="true"');
    expect(drawer).toContain('closedby="any"');
    expect(drawer).toContain('id="account-drawer" open role="dialog"');
    expect(drawer).toContain('data-style-src="drawer.tsx#content; drawer.tsx#bottom"');
    expect(drawer).toContain('data-style-src="drawer.tsx#handle" aria-hidden="true"');
    expect(drawer).toContain('command="request-close" commandfor="account-drawer"');
  });
});
