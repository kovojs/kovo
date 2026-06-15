import { describe, expect, it } from 'vitest';

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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Menubar,
  MenubarItem,
  MenubarSubmenu,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  Sheet,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
  commandDialogClasses,
  commandInputClasses,
  commandItemClasses,
  commandListboxClasses,
  commandTriggerClasses,
  contextMenuContentClasses,
  contextMenuItemClasses,
  contextMenuTriggerClasses,
  dropdownMenuContentClasses,
  dropdownMenuItemClasses,
  dropdownMenuTriggerClasses,
  menubarItemClasses,
  menubarSubmenuClasses,
  navigationMenuContentClasses,
  navigationMenuLinkClasses,
  navigationMenuListClasses,
  navigationMenuTriggerClasses,
  navigationMenuViewportClasses,
  drawerContentClasses,
  sheetContentClasses,
  toastActionClasses,
  toastCloseClasses,
  toastDescriptionClasses,
  toastTitleClasses,
} from './index.js';

describe('@jiso/ui styled package foundation', () => {
  it('wraps the headless toast primitive as styled live-region markup', () => {
    const toast = Toast.definition.render({
      children: `${ToastTitle.definition.render({
        children: 'Deployment complete',
        id: 'deploy-toast-title',
      })}${ToastDescription.definition.render({
        children: 'Production is serving the new build.',
        id: 'deploy-toast-description',
      })}${ToastAction.definition.render({
        actionValue: 'open-deploy',
        children: 'View',
        id: 'deploy-toast',
        variant: 'success',
      })}${ToastAction.definition.render({
        actionValue: 'keep-open',
        children: 'Keep open',
        dismissOnAction: false,
        id: 'deploy-toast',
        variant: 'success',
      })}${ToastAction.definition.render({
        actionValue: 'blocked',
        children: 'Blocked',
        disabled: true,
        dismissOnAction: false,
        id: 'deploy-toast',
        variant: 'success',
      })}${ToastClose.definition.render({
        children: 'Dismiss',
        id: 'deploy-toast',
        variant: 'success',
      })}`,
      descriptionId: 'deploy-toast-description',
      id: 'deploy-toast',
      titleId: 'deploy-toast-title',
      variant: 'success',
    });
    const viewport = ToastViewport.definition.render({
      children: toast,
      id: 'toast-viewport',
      label: 'Build notifications',
      placement: 'top-center',
    });
    const hiddenToast = Toast.definition.render({ id: 'hidden-toast', open: false });

    expect(ToastViewport.name).toBe('toast-viewport');
    expect(ToastTitle.name).toBe('toast-title');
    expect(ToastDescription.name).toBe('toast-description');
    expect(ToastAction.name).toBe('toast-action');
    expect(ToastClose.name).toBe('toast-close');
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
    expect(toastTitleClasses.join(' ')).toContain('font-medium');
    expect(toastDescriptionClasses.join(' ')).toContain('text-neutral-700');
    expect(toastActionClasses.join(' ')).toContain('border border-neutral-300');
    expect(toastCloseClasses.join(' ')).toContain('h-8 w-8');
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
    const dropdown = DropdownMenu.definition.render({
      ...dropdownState,
      children: `${DropdownMenuTrigger.definition.render({
        ...dropdownState,
        contentId: 'file-actions-menu',
        id: 'file-actions-trigger',
      })}${DropdownMenuContent.definition.render({
        ...dropdownState,
        children: dropdownItems
          .map((item) =>
            DropdownMenuItem.definition.render({
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
    });
    const context = ContextMenu.definition.render({
      children: `${ContextMenuTrigger.definition.render({
        contentId: 'row-menu',
        id: 'row-trigger',
        open: true,
      })}${ContextMenuContent.definition.render({
        children: `${ContextMenuItem.definition.render({
          highlightedValue: 'inspect',
          itemLabel: 'Inspect',
          itemValue: 'inspect',
          open: true,
        })}${ContextMenuItem.definition.render({
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
    });

    expect(DropdownMenuTrigger.name).toBe('dropdown-menu-trigger');
    expect(DropdownMenuContent.name).toBe('dropdown-menu-content');
    expect(DropdownMenuItem.name).toBe('dropdown-menu-item');
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
    expect(dropdownMenuTriggerClasses.join(' ')).toContain('data-[state=open]:bg-neutral-100');
    expect(dropdownMenuContentClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(dropdownMenuItemClasses.join(' ')).toContain('data-[highlighted]:bg-neutral-100');

    expect(ContextMenuTrigger.name).toBe('context-menu-trigger');
    expect(ContextMenuContent.name).toBe('context-menu-content');
    expect(ContextMenuItem.name).toBe('context-menu-item');
    expect(context).toContain('jiso-context-menu="row-menu"');
    expect(context).toContain('aria-haspopup="menu"');
    expect(context).toContain('data-anchor-x="24" data-anchor-y="32"');
    expect(context).toContain('role="menu" tabIndex="-1"');
    expect(context).toContain('data-highlighted="" data-state="active"');
    expect(context).toContain('aria-disabled="true"');
    expect(context).toContain(
      'disabled role="menuitem" tabIndex="-1" type="button" value="delete"',
    );
    expect(contextMenuTriggerClasses.join(' ')).toContain('border-dashed');
    expect(contextMenuContentClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(contextMenuItemClasses.join(' ')).toContain('data-[highlighted]:bg-neutral-100');
  });

  it('wraps menubar and navigation-menu primitives as styled roving navigation', () => {
    const menubarItems = [
      { hasPopup: true, label: 'File', value: 'file' },
      { label: 'Edit', value: 'edit' },
      { label: 'New', parentValue: 'file', value: 'new' },
      { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
    ];
    const menubar = Menubar.definition.render({
      activeValue: 'file',
      children: `${MenubarItem.definition.render({
        activeValue: 'file',
        contentId: 'file-menu',
        itemLabel: 'File',
        itemValue: 'file',
        items: menubarItems,
        openValue: 'file',
      })}${MenubarItem.definition.render({
        activeValue: 'file',
        itemLabel: 'Edit',
        itemValue: 'edit',
        items: menubarItems,
        openValue: 'file',
      })}${MenubarSubmenu.definition.render({
        children: `${MenubarItem.definition.render({
          activeValue: 'new',
          itemLabel: 'New',
          itemParentValue: 'file',
          itemValue: 'new',
          items: menubarItems,
          openValue: 'file',
        })}${MenubarItem.definition.render({
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
    });
    const navItems = [
      { hasContent: true, label: 'Products', value: 'products' },
      { label: 'Docs', value: 'docs' },
    ];
    const navigation = NavigationMenu.definition.render({
      activeValue: 'products',
      children: `${NavigationMenuList.definition.render({
        activeValue: 'products',
        children: `${NavigationMenuItem.definition.render({
          activeValue: 'products',
          children: NavigationMenuTrigger.definition.render({
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
        })}${NavigationMenuItem.definition.render({
          activeValue: 'products',
          children: NavigationMenuLink.definition.render({
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
      })}${NavigationMenuContent.definition.render({
        children: 'Product links',
        id: 'products-panel',
        openValue: 'products',
        value: 'products',
      })}${NavigationMenuViewport.definition.render({
        id: 'products-viewport',
        openValue: 'products',
      })}`,
      items: navItems,
      label: 'Primary',
      openValue: 'products',
    });

    expect(MenubarItem.name).toBe('menubar-item');
    expect(MenubarSubmenu.name).toBe('menubar-submenu');
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
    expect(menubarItemClasses.join(' ')).toContain('data-[state=open]:bg-neutral-100');
    expect(menubarSubmenuClasses.join(' ')).toContain('data-[state=closed]:hidden');

    expect(NavigationMenuList.name).toBe('navigation-menu-list');
    expect(NavigationMenuTrigger.name).toBe('navigation-menu-trigger');
    expect(NavigationMenuContent.name).toBe('navigation-menu-content');
    expect(NavigationMenuLink.name).toBe('navigation-menu-link');
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
    expect(navigationMenuListClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(navigationMenuTriggerClasses.join(' ')).toContain('data-[state=open]:bg-neutral-100');
    expect(navigationMenuLinkClasses.join(' ')).toContain('hover:bg-neutral-100');
    expect(navigationMenuContentClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(navigationMenuViewportClasses.join(' ')).toContain('data-[state=closed]:hidden');
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
    const command = Command.definition.render({
      ...state,
      children: `${CommandTrigger.definition.render({
        ...state,
        contentId: 'command-dialog',
        id: 'command-trigger',
      })}${CommandDialog.definition.render({
        ...state,
        children: `${CommandInput.definition.render({
          ...state,
          id: 'command-input',
          labelledBy: 'command-title',
          listboxId: 'command-listbox',
        })}${CommandListbox.definition.render({
          ...state,
          children: items
            .map((item) =>
              CommandItem.definition.render({
                ...state,
                ...(item.disabled === undefined ? {} : { itemDisabled: item.disabled }),
                itemLabel: item.label,
                itemValue: item.value,
              }),
            )
            .join(''),
          id: 'command-listbox',
          labelledBy: 'command-title',
        })}${CommandEmpty.definition.render({
          inputValue: 'zzz',
          items,
        })}${CommandClose.definition.render({
          ...state,
          contentId: 'command-dialog',
        })}${CommandValue.definition.render({
          ...state,
          id: 'command-value',
        })}`,
        contentId: 'command-dialog',
        descriptionId: 'command-description',
        titleId: 'command-title',
      })}`,
      id: 'command-root',
    });

    expect(CommandTrigger.name).toBe('command-trigger');
    expect(CommandDialog.name).toBe('command-dialog');
    expect(CommandInput.name).toBe('command-input');
    expect(CommandListbox.name).toBe('command-listbox');
    expect(CommandItem.name).toBe('command-item');
    expect(CommandClose.name).toBe('command-close');
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
    expect(command).toContain('disabled role="option" tabIndex="-1" type="button" value="delete"');
    expect(command).toContain('command="request-close" commandfor="command-dialog"');
    expect(command).toContain('id="command-value">Invite teammate</span>');
    expect(commandTriggerClasses.join(' ')).toContain('data-[state=open]:bg-neutral-100');
    expect(commandDialogClasses.join(' ')).toContain('backdrop:bg-black/20');
    expect(commandInputClasses.join(' ')).toContain('focus-visible:ring-2');
    expect(commandListboxClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(commandItemClasses.join(' ')).toContain('data-[state=checked]:font-medium');
  });

  it('wraps the headless dialog primitive for a bounded sheet component', () => {
    expect(Sheet.name).toBe('sheet');
    expect(Drawer.name).toBe('drawer');

    const rendered = Sheet.definition.render({
      children: 'Sheet body',
      contentId: 'account-sheet',
      description: 'Manage account settings',
      open: true,
      side: 'left',
      title: 'Account',
      trigger: 'Settings',
    });

    expect(rendered).toContain('aria-controls="account-sheet"');
    expect(rendered).toContain('command="show-modal" commandfor="account-sheet"');
    expect(rendered).toContain('<dialog aria-describedby="account-sheet-description"');
    expect(rendered).toContain('closedby="any"');
    expect(rendered).toContain('id="account-sheet" open>');
    expect(rendered).toContain('inset-y-0 left-0 w-full max-w-sm border-r');
    expect(rendered).toContain('command="request-close" commandfor="account-sheet"');

    const topSheet = Sheet.definition.render({
      contentId: 'top-sheet',
      side: 'top',
      title: 'Top sheet',
    });
    const drawer = Drawer.definition.render({
      children: 'Drawer body',
      contentId: 'account-drawer',
      description: 'Mobile actions',
      open: true,
      title: 'Actions',
      trigger: 'Open drawer',
    });

    expect(sheetContentClasses).toContain('inset-y-0 right-0 w-full max-w-sm border-l');
    expect(sheetContentClasses).toContain('inset-x-0 bottom-0 max-h-[85vh] border-t');
    expect(drawerContentClasses).toContain('inset-x-0 bottom-0 max-h-[85vh] border-t');
    expect(drawerContentClasses).toContain('inset-y-0 right-0 w-full max-w-sm border-l');
    expect(topSheet).toContain('top-0 max-h-[85vh] border-b');
    expect(drawer).toContain('command="show-modal" commandfor="account-drawer"');
    expect(drawer).toContain('<dialog aria-describedby="account-drawer-description"');
    expect(drawer).toContain('closedby="any"');
    expect(drawer).toContain('id="account-drawer" open>');
    expect(drawer).toContain('bottom-0 max-h-[85vh] border-t');
    expect(drawer).toContain(
      'aria-hidden="true" class="mx-auto h-1.5 w-12 rounded-full bg-neutral-300"',
    );
    expect(drawer).toContain('command="request-close" commandfor="account-drawer"');
  });
});
