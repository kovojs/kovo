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

export interface PlatformBehaviorLowering {
  replacements: SourceReplacement[];
  substitutions: PlatformSubstitution[];
}

export function platformBehaviorLowering(
  source: string,
  model: ComponentModuleModel,
): PlatformBehaviorLowering {
  const matches = jsxElements(model).flatMap((element) => {
    const onClick = element.attributes.find((attribute) => attribute.name === 'onClick');
    const action = onClick?.zeroArgArrow?.documentElementAction;
    const substitution = action
      ? platformSubstitutionFromDocumentAction(element.tag, action)
      : null;
    return onClick && substitution ? [{ attribute: onClick, substitution }] : [];
  });
  const replacements: SourceReplacement[] = matches.map((match) => {
    const attributes = platformAttributes(match.substitution);
    const span =
      attributes === ''
        ? sourceRangeWithLeadingWhitespace(source, match.attribute.start, match.attribute.end)
        : { end: match.attribute.end, start: match.attribute.start };
    return { ...span, replacement: attributes };
  });

  return {
    replacements,
    substitutions: matches.map((match) => match.substitution),
  };
}

function platformSubstitutionFromDocumentAction(
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

  return platformSubstitutionFor(tag, action.target, action.method);
}

function sourceRangeWithLeadingWhitespace(
  source: string,
  start: number,
  end: number,
): { end: number; start: number } {
  let removeStart = start;
  while (removeStart > 0 && /\s/.test(source[removeStart - 1] ?? '')) {
    removeStart -= 1;
  }

  return { end, start: removeStart };
}

function platformSubstitutionFor(
  tag: string,
  target: string,
  method: string,
): PlatformSubstitution | null {
  if (method === 'showModal') {
    return { action: 'show-modal', event: 'click', kind: 'dialog', tag, target };
  }

  if (method === 'close') {
    return { action: 'close', event: 'click', kind: 'dialog', tag, target };
  }

  // SPEC §5.2.4: provable dialog handlers lower to platform invoker commands.
  if (method === 'requestClose') {
    return { action: 'request-close', event: 'click', kind: 'dialog', tag, target };
  }

  const popoverActionByMethod: Record<string, string> = {
    hidePopover: 'hide',
    showPopover: 'show',
    togglePopover: 'toggle',
  };
  const action = popoverActionByMethod[method];
  if (!action) return null;

  return { action, event: 'click', kind: 'popover', tag, target };
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
