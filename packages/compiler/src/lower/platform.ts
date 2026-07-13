import {
  jsxElements,
  type ComponentModuleModel,
  type DocumentElementActionModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute } from '../shared.js';
import { compilerArrayLength, compilerOwnDataValue } from '../compiler-security-intrinsics.js';

/**
 * @internal A lowered platform-behavior substitution: a provable event handler the compiler
 * rewrites to a native invoker command (dialog/popover/details). Carried in
 * {@link CompileResult}; lowered-IR fact, in-repo use only (SPEC.md §5.2.4).
 */
export interface PlatformSubstitution {
  action: string;
  event: string;
  kind: 'details' | 'dialog' | 'popover';
  tag: string;
  target: string;
}

export interface PlatformElementSubstitution {
  attribute: JsxAttributeModel;
  substitution: PlatformSubstitution;
}

export function platformElementSubstitution(
  model: ComponentModuleModel,
  element: JsxElementModel,
): PlatformElementSubstitution | null {
  const onClick = elementAttributeMatching(
    element,
    (attribute) => attribute.domEventName === 'click',
    'Platform event attributes',
  );
  const action = onClick?.zeroArgArrow?.documentElementAction;
  const substitution = action
    ? platformSubstitutionFromDocumentAction(model, element.tag, action)
    : null;
  return onClick && substitution ? { attribute: onClick, substitution } : null;
}

function platformSubstitutionFromDocumentAction(
  model: ComponentModuleModel,
  tag: string,
  action: DocumentElementActionModel,
): PlatformSubstitution | null {
  if (action.action === 'toggle-open' && tag === 'summary') {
    return {
      action: 'toggle',
      event: 'click',
      kind: 'details',
      tag,
      target: action.target,
    };
  }

  if (action.action !== 'method' || !action.method) return null;

  return platformSubstitutionFor(model, tag, action.target, action.method);
}

function platformSubstitutionFor(
  model: ComponentModuleModel,
  tag: string,
  target: string,
  method: string,
): PlatformSubstitution | null {
  if (tag !== 'button') return null;

  // FN13 (plans/compiler-refactoring.md): method->action substitutions as data.
  // SPEC §5.2.4: provable dialog handlers lower to platform invoker commands.
  const dialogAction =
    method === 'showModal'
      ? 'show-modal'
      : method === 'close'
        ? 'close'
        : method === 'requestClose'
          ? 'request-close'
          : undefined;
  if (dialogAction) {
    return hasDialogTarget(model, target)
      ? { action: dialogAction, event: 'click', kind: 'dialog', tag, target }
      : null;
  }

  const popoverAction =
    method === 'hidePopover'
      ? 'hide'
      : method === 'showPopover'
        ? 'show'
        : method === 'togglePopover'
          ? 'toggle'
          : undefined;
  if (!popoverAction) return null;

  return hasPopoverTarget(model, target)
    ? { action: popoverAction, event: 'click', kind: 'popover', tag, target }
    : null;
}

function hasDialogTarget(model: ComponentModuleModel, target: string): boolean {
  const elements = jsxElements(model);
  const length = compilerArrayLength(elements, 'Platform JSX elements');
  for (let index = 0; index < length; index += 1) {
    const element = compilerOwnDataValue(
      elements,
      index,
      'Platform JSX elements',
    ) as JsxElementModel;
    if (element.tag === 'dialog' && hasLiteralId(element, target)) return true;
  }
  return false;
}

function hasPopoverTarget(model: ComponentModuleModel, target: string): boolean {
  const elements = jsxElements(model);
  const length = compilerArrayLength(elements, 'Platform JSX elements');
  for (let index = 0; index < length; index += 1) {
    const element = compilerOwnDataValue(
      elements,
      index,
      'Platform JSX elements',
    ) as JsxElementModel;
    if (hasLiteralId(element, target) && hasPopoverAttribute(element)) return true;
  }
  return false;
}

function hasLiteralId(element: ReturnType<typeof jsxElements>[number], target: string): boolean {
  return (
    elementAttributeMatching(
      element,
      (attribute) => attribute.name === 'id' && attribute.value === target,
      'Platform target attributes',
    ) !== undefined
  );
}

function hasPopoverAttribute(element: ReturnType<typeof jsxElements>[number]): boolean {
  return (
    elementAttributeMatching(
      element,
      (attribute) => attribute.name === 'popover',
      'Platform target attributes',
    ) !== undefined
  );
}

function elementAttributeMatching(
  element: JsxElementModel,
  predicate: (attribute: JsxAttributeModel) => boolean,
  label: string,
): JsxAttributeModel | undefined {
  const length = compilerArrayLength(element.attributes, label);
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(element.attributes, index, label) as JsxAttributeModel;
    if (predicate(attribute)) return attribute;
  }
  return undefined;
}

/** @internal A single lowered platform attribute (name + already-escaped value). */
export interface PlatformAttribute {
  name: string;
  value: string;
}

/**
 * @internal FN13 (plans/compiler-refactoring.md): the structured attribute list a
 * platform substitution lowers to. Values are pre-escaped for an HTML attribute
 * context. Returned as typed pairs so `lowerStructuralJsx` builds `JsxIrAttribute`s
 * directly instead of re-parsing a serialized attribute string by `split(' ')`.
 */
export function platformAttributeList(substitution: PlatformSubstitution): PlatformAttribute[] {
  if (substitution.kind === 'dialog') {
    return [
      { name: 'commandfor', value: escapeAttribute(substitution.target) },
      { name: 'command', value: substitution.action },
    ];
  }

  if (substitution.kind === 'details') {
    return [];
  }

  return [
    { name: 'popovertarget', value: escapeAttribute(substitution.target) },
    { name: 'popovertargetaction', value: substitution.action },
  ];
}
