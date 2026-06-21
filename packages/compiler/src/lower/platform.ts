import {
  jsxElements,
  type ComponentModuleModel,
  type DocumentElementActionModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute } from '../shared.js';

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
  const onClick = element.attributes.find((attribute) => attribute.domEventName === 'click');
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

  if (method === 'showModal') {
    return hasDialogTarget(model, target)
      ? { action: 'show-modal', event: 'click', kind: 'dialog', tag, target }
      : null;
  }

  if (method === 'close') {
    return hasDialogTarget(model, target)
      ? { action: 'close', event: 'click', kind: 'dialog', tag, target }
      : null;
  }

  // SPEC §5.2.4: provable dialog handlers lower to platform invoker commands.
  if (method === 'requestClose') {
    return hasDialogTarget(model, target)
      ? { action: 'request-close', event: 'click', kind: 'dialog', tag, target }
      : null;
  }

  const popoverActionByMethod: Record<string, string> = {
    hidePopover: 'hide',
    showPopover: 'show',
    togglePopover: 'toggle',
  };
  const action = popoverActionByMethod[method];
  if (!action) return null;

  return hasPopoverTarget(model, target)
    ? { action, event: 'click', kind: 'popover', tag, target }
    : null;
}

function hasDialogTarget(model: ComponentModuleModel, target: string): boolean {
  return jsxElements(model).some(
    (element) => element.tag === 'dialog' && hasLiteralId(element, target),
  );
}

function hasPopoverTarget(model: ComponentModuleModel, target: string): boolean {
  return jsxElements(model).some(
    (element) => hasLiteralId(element, target) && hasPopoverAttribute(element),
  );
}

function hasLiteralId(element: ReturnType<typeof jsxElements>[number], target: string): boolean {
  return element.attributes.some(
    (attribute) => attribute.name === 'id' && attribute.value === target,
  );
}

function hasPopoverAttribute(element: ReturnType<typeof jsxElements>[number]): boolean {
  return element.attributes.some((attribute) => attribute.name === 'popover');
}

export function platformAttributes(substitution: PlatformSubstitution): string {
  if (substitution.kind === 'dialog') {
    return `commandfor="${escapeAttribute(substitution.target)}" command="${substitution.action}"`;
  }

  if (substitution.kind === 'details') {
    return '';
  }

  return `popovertarget="${escapeAttribute(substitution.target)}" popovertargetaction="${substitution.action}"`;
}
