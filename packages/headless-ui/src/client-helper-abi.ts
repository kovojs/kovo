import {
  contextMenuMove as contextMenuMoveImplementation,
  contextMenuTypeahead as contextMenuTypeaheadImplementation,
} from './primitives/context-menu.js';
import {
  dropdownMenuMove as dropdownMenuMoveImplementation,
  dropdownMenuTypeahead as dropdownMenuTypeaheadImplementation,
} from './primitives/dropdown-menu.js';
import {
  menubarMove as menubarMoveImplementation,
  menubarTypeahead as menubarTypeaheadImplementation,
} from './primitives/menubar.js';
import {
  navigationMenuMove as navigationMenuMoveImplementation,
  navigationMenuTypeahead as navigationMenuTypeaheadImplementation,
} from './primitives/navigation-menu.js';
import { selectMove as selectMoveImplementation } from './primitives/select.js';
import type {
  ContextMenuMoveResult,
  ContextMenuState,
  ContextMenuTypeaheadOptions,
  ContextMenuTypeaheadResult,
} from './public/context-menu.js';
import type {
  DropdownMenuMoveResult,
  DropdownMenuState,
  DropdownMenuTypeaheadOptions,
  DropdownMenuTypeaheadResult,
} from './public/dropdown-menu.js';
import type {
  MenubarMoveOptions,
  MenubarMoveResult,
  MenubarState,
  MenubarTypeaheadOptions,
  MenubarTypeaheadResult,
} from './public/menubar.js';
import type {
  NavigationMenuMoveOptions,
  NavigationMenuMoveResult,
  NavigationMenuState,
  NavigationMenuTypeaheadOptions,
  NavigationMenuTypeaheadResult,
} from './public/navigation-menu.js';
import type { SelectMoveResult, SelectState } from './public/select.js';

/**
 * Generated client ABI binding for the internal context-menu move reducer.
 *
 * SPEC.md §5.2: compiler-emitted handlers import executable helpers only through the finite
 * reviewed ABI. The implementation remains internal; this binding exposes only public types.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const contextMenuMove: (
  state: ContextMenuState,
  key: string,
  options?: { loop?: boolean },
) => ContextMenuMoveResult | undefined = contextMenuMoveImplementation;

/**
 * Generated client ABI binding for the internal context-menu typeahead reducer.
 *
 * SPEC.md §5.2: the compiler may emit this exact reviewed helper without publishing its
 * implementation as app-authored API.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const contextMenuTypeahead: (
  state: ContextMenuState,
  key: string,
  options: ContextMenuTypeaheadOptions,
) => ContextMenuTypeaheadResult = contextMenuTypeaheadImplementation;

/**
 * Generated client ABI binding for the internal dropdown-menu move reducer.
 *
 * SPEC.md §5.2: the generated binding keeps browser authority finite while the underlying
 * implementation remains internal.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const dropdownMenuMove: (
  state: DropdownMenuState,
  key: string,
  options?: { loop?: boolean },
) => DropdownMenuMoveResult | undefined = dropdownMenuMoveImplementation;

/**
 * Generated client ABI binding for the internal dropdown-menu typeahead reducer.
 *
 * SPEC.md §5.2: compiler-emitted code receives only this reviewed, public-typed callable.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const dropdownMenuTypeahead: (
  state: DropdownMenuState,
  key: string,
  options: DropdownMenuTypeaheadOptions,
) => DropdownMenuTypeaheadResult = dropdownMenuTypeaheadImplementation;

/**
 * Generated client ABI binding for the internal menubar move reducer.
 *
 * SPEC.md §5.2: compiler-emitted code receives only this reviewed, public-typed callable.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const menubarMove: (
  state: MenubarState,
  key: string,
  options?: MenubarMoveOptions,
) => MenubarMoveResult | undefined = menubarMoveImplementation;

/**
 * Generated client ABI binding for the internal menubar typeahead reducer.
 *
 * SPEC.md §5.2: compiler-emitted code receives only this reviewed, public-typed callable.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const menubarTypeahead: (
  state: MenubarState,
  key: string,
  options: MenubarTypeaheadOptions,
) => MenubarTypeaheadResult = menubarTypeaheadImplementation;

/**
 * Generated client ABI binding for the internal navigation-menu move reducer.
 *
 * SPEC.md §5.2: compiler-emitted code receives only this reviewed, public-typed callable.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const navigationMenuMove: (
  state: NavigationMenuState,
  key: string,
  options?: NavigationMenuMoveOptions,
) => NavigationMenuMoveResult | undefined = navigationMenuMoveImplementation;

/**
 * Generated client ABI binding for the internal navigation-menu typeahead reducer.
 *
 * SPEC.md §5.2: compiler-emitted code receives only this reviewed, public-typed callable.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const navigationMenuTypeahead: (
  state: NavigationMenuState,
  key: string,
  options: NavigationMenuTypeaheadOptions,
) => NavigationMenuTypeaheadResult = navigationMenuTypeaheadImplementation;

/**
 * Generated client ABI binding for the internal select move reducer.
 *
 * SPEC.md §5.2: compiler-emitted code receives only this reviewed, public-typed callable.
 *
 * @generated
 * @kovoGeneratedClientHelper
 */
export const selectMove: (
  state: SelectState,
  key: string,
  options?: { loop?: boolean },
) => SelectMoveResult | undefined = selectMoveImplementation;
