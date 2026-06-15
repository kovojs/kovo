import {
  jsxElements,
  type ComponentModuleModel,
  type DocumentElementActionModel,
} from '../scan/parse.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';

export interface PlatformSubstitution {
  action: string;
  event: string;
  kind: 'details' | 'dialog' | 'popover';
  tag: string;
  target: string;
}

interface PlatformBehaviorLowering {
  replacements: SourceReplacement[];
  substitutions: PlatformSubstitution[];
}

export function platformBehaviorLowering(model: ComponentModuleModel): PlatformBehaviorLowering {
  const matches = jsxElements(model).flatMap((element) => {
    const onClick = element.attributes.find((attribute) => attribute.domEventName === 'click');
    const action = onClick?.zeroArgArrow?.documentElementAction;
    const substitution = action
      ? platformSubstitutionFromDocumentAction(model, element.tag, action)
      : null;
    return onClick && substitution ? [{ attribute: onClick, substitution }] : [];
  });
  const replacements: SourceReplacement[] = matches.map((match) => {
    const attributes = platformAttributes(match.substitution);
    const span =
      attributes === ''
        ? { end: match.attribute.end, start: match.attribute.leadingStart }
        : { end: match.attribute.end, start: match.attribute.start };
    return { ...span, replacement: attributes };
  });

  return {
    replacements,
    substitutions: matches.map((match) => match.substitution),
  };
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

function platformAttributes(substitution: PlatformSubstitution): string {
  if (substitution.kind === 'dialog') {
    return `commandfor="${escapeAttribute(substitution.target)}" command="${substitution.action}"`;
  }

  if (substitution.kind === 'details') {
    return '';
  }

  return `popovertarget="${escapeAttribute(substitution.target)}" popovertargetaction="${substitution.action}"`;
}
