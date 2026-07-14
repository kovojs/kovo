import { securityClassifier } from '@kovojs/core/internal/security-markers';

import {
  compilerArrayIsArray,
  compilerArrayLength,
  compilerFailClosed,
  compilerFreeze,
  compilerObjectKeys,
  compilerOwnDataValue,
} from './compiler-security-intrinsics.js';

/**
 * Exact public `@kovojs/ui/<component>` exports that are framework-owned component descriptors.
 *
 * This is pinned from `packages/ui/registry.json`; the companion test fails on registry drift.
 * Helper modules and arbitrary names under the package prefix are deliberately absent because an
 * unreviewed export must never acquire host-event lowering merely by being aliased in JSX.
 */
const mutableReviewedComponentEventBoundaries: Record<string, readonly string[]> = {
  '@kovojs/ui/accordion': [
    'Accordion',
    'AccordionItem',
    'AccordionHeader',
    'AccordionTrigger',
    'AccordionContent',
  ],
  '@kovojs/ui/alert': ['Alert'],
  '@kovojs/ui/alert-dialog': [
    'AlertDialog',
    'AlertDialogTrigger',
    'AlertDialogContent',
    'AlertDialogCancel',
    'AlertDialogAction',
    'AlertDialogHeader',
    'AlertDialogTitle',
    'AlertDialogDescription',
    'AlertDialogFooter',
  ],
  '@kovojs/ui/autocomplete': [
    'Autocomplete',
    'AutocompleteInput',
    'AutocompleteList',
    'AutocompleteOption',
    'AutocompleteValue',
  ],
  '@kovojs/ui/avatar': ['Avatar', 'AvatarImage', 'AvatarFallback'],
  '@kovojs/ui/badge': ['Badge'],
  '@kovojs/ui/breadcrumb': [
    'Breadcrumb',
    'BreadcrumbItem',
    'BreadcrumbLink',
    'BreadcrumbSeparator',
  ],
  '@kovojs/ui/button': ['Button'],
  '@kovojs/ui/card': ['Card'],
  '@kovojs/ui/checkbox': ['Checkbox'],
  '@kovojs/ui/checkbox-group': [
    'CheckboxGroup',
    'CheckboxGroupItem',
    'CheckboxGroupControl',
    'CheckboxGroupLabel',
  ],
  '@kovojs/ui/collapsible': ['Collapsible', 'CollapsibleTrigger', 'CollapsibleContent'],
  '@kovojs/ui/combobox': [
    'Combobox',
    'ComboboxInput',
    'ComboboxListbox',
    'ComboboxOption',
    'ComboboxValue',
  ],
  '@kovojs/ui/command': [
    'Command',
    'CommandTrigger',
    'CommandDialog',
    'CommandInput',
    'CommandListbox',
    'CommandItem',
    'CommandClose',
    'CommandEmpty',
    'CommandValue',
  ],
  '@kovojs/ui/context-menu': [
    'ContextMenu',
    'ContextMenuTrigger',
    'ContextMenuContent',
    'ContextMenuItem',
    'ContextMenuGroup',
    'ContextMenuSeparator',
  ],
  '@kovojs/ui/dialog': [
    'Dialog',
    'DialogTrigger',
    'DialogContent',
    'DialogClose',
    'DialogCloseX',
    'DialogHeader',
    'DialogTitle',
    'DialogDescription',
  ],
  '@kovojs/ui/disclosure': ['Disclosure', 'DisclosureTrigger', 'DisclosureContent'],
  '@kovojs/ui/drawer': [
    'Drawer',
    'DrawerRoot',
    'DrawerTrigger',
    'DrawerContent',
    'DrawerHandle',
    'DrawerHeader',
    'DrawerTitle',
    'DrawerDescription',
    'DrawerClose',
  ],
  '@kovojs/ui/dropdown-menu': [
    'DropdownMenu',
    'DropdownMenuTrigger',
    'DropdownMenuContent',
    'DropdownMenuItem',
    'DropdownMenuGroup',
    'DropdownMenuSeparator',
  ],
  '@kovojs/ui/field': [
    'Field',
    'FieldLabel',
    'FieldControl',
    'FieldTextarea',
    'FieldSelect',
    'FieldSelectOption',
    'FieldDescription',
    'FieldErrorMessage',
    'Fieldset',
    'FieldsetLegend',
  ],
  '@kovojs/ui/hover-card': ['HoverCard', 'HoverCardTrigger', 'HoverCardContent'],
  '@kovojs/ui/kbd': ['Kbd'],
  '@kovojs/ui/menubar': [
    'Menubar',
    'MenubarItem',
    'MenubarSubmenu',
    'MenubarGroup',
    'MenubarSeparator',
  ],
  '@kovojs/ui/meter': ['Meter'],
  '@kovojs/ui/navigation-menu': [
    'NavigationMenu',
    'NavigationMenuList',
    'NavigationMenuItem',
    'NavigationMenuTrigger',
    'NavigationMenuContent',
    'NavigationMenuLink',
    'NavigationMenuViewport',
    'NavigationMenuIndicator',
  ],
  '@kovojs/ui/number-field': [
    'NumberField',
    'NumberFieldControl',
    'NumberFieldInput',
    'NumberFieldDecrement',
    'NumberFieldIncrement',
  ],
  '@kovojs/ui/otp-field': ['OtpField', 'OtpFieldGroup', 'OtpFieldHiddenInput', 'OtpFieldInput'],
  '@kovojs/ui/popover': ['Popover', 'PopoverTrigger', 'PopoverContent'],
  '@kovojs/ui/progress': ['Progress'],
  '@kovojs/ui/radio-group': ['RadioGroup', 'RadioGroupItem', 'RadioGroupRadio', 'RadioGroupLabel'],
  '@kovojs/ui/scroll-area': [
    'ScrollArea',
    'ScrollAreaViewport',
    'ScrollAreaScrollbar',
    'ScrollAreaThumb',
    'ScrollAreaCorner',
  ],
  '@kovojs/ui/select': [
    'Select',
    'SelectTrigger',
    'SelectHiddenInput',
    'SelectContent',
    'SelectItem',
    'SelectValue',
  ],
  '@kovojs/ui/separator': ['Separator'],
  '@kovojs/ui/sheet': [
    'Sheet',
    'SheetRoot',
    'SheetTrigger',
    'SheetContent',
    'SheetHeader',
    'SheetTitle',
    'SheetDescription',
    'SheetClose',
  ],
  '@kovojs/ui/skeleton': ['Skeleton'],
  '@kovojs/ui/slider': ['Slider', 'SliderInput', 'SliderTrack', 'SliderRange', 'SliderThumb'],
  '@kovojs/ui/switch': ['Switch'],
  '@kovojs/ui/table': [
    'Table',
    'TableHead',
    'TableBody',
    'TableRow',
    'TableHeaderCell',
    'TableCell',
  ],
  '@kovojs/ui/tabs': ['Tabs', 'TabsList', 'TabsTrigger', 'TabsPanel'],
  '@kovojs/ui/toast': [
    'ToastViewport',
    'Toast',
    'ToastTitle',
    'ToastDescription',
    'ToastAction',
    'ToastClose',
  ],
  '@kovojs/ui/toggle': ['Toggle'],
  '@kovojs/ui/toggle-group': ['ToggleGroup', 'ToggleGroupItem', 'ToggleGroupButton'],
  '@kovojs/ui/toolbar': ['Toolbar', 'ToolbarItem', 'ToolbarButton'],
  '@kovojs/ui/tooltip': ['Tooltip', 'TooltipTrigger', 'TooltipContent'],
};

const reviewedBoundaryModules = compilerObjectKeys(mutableReviewedComponentEventBoundaries);
const reviewedBoundaryModuleLength = compilerArrayLength(
  reviewedBoundaryModules,
  'Reviewed component event-boundary modules',
);
for (let moduleIndex = 0; moduleIndex < reviewedBoundaryModuleLength; moduleIndex += 1) {
  const moduleSpecifier = compilerOwnDataValue(
    reviewedBoundaryModules,
    moduleIndex,
    'Reviewed component event-boundary modules',
  );
  if (typeof moduleSpecifier !== 'string') {
    compilerFailClosed(
      `Reviewed component event-boundary modules[${moduleIndex}] must be a string.`,
    );
  }
  const exports = compilerOwnDataValue(
    mutableReviewedComponentEventBoundaries,
    moduleSpecifier,
    'Reviewed component event-boundary registry',
  );
  if (!compilerArrayIsArray(exports)) {
    compilerFailClosed(`Reviewed component event-boundary ${moduleSpecifier} must be an array.`);
  }
  compilerFreeze(exports);
}

export const reviewedComponentEventBoundaries = compilerFreeze(
  mutableReviewedComponentEventBoundaries,
);

export const isReviewedComponentEventBoundary = securityClassifier(
  'compiler.component-event-boundary.is-reviewed',
  function (moduleSpecifier: string, importedName: string): boolean {
    const exports = compilerOwnDataValue(
      reviewedComponentEventBoundaries,
      moduleSpecifier,
      'Reviewed component event-boundary registry',
    ) as readonly string[] | undefined;
    if (exports === undefined) return false;
    const exportLength = compilerArrayLength(exports, 'Reviewed component event-boundary exports');
    for (let exportIndex = 0; exportIndex < exportLength; exportIndex += 1) {
      const candidate = compilerOwnDataValue(
        exports,
        exportIndex,
        'Reviewed component event-boundary exports',
      );
      if (candidate === importedName) return true;
    }
    return false;
  },
);
