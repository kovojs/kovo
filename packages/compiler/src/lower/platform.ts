import { escapeAttribute } from '../shared.js';
import { jsxElements, type ComponentModuleModel } from '../scan/parse.js';

export interface PlatformSubstitution {
  action: string;
  event: string;
  kind: 'details' | 'dialog' | 'popover';
  tag: string;
  target: string;
}

export function lowerPlatformBehaviors(
  source: string,
  model: ComponentModuleModel,
): {
  source: string;
  substitutions: PlatformSubstitution[];
} {
  const matches = jsxElements(model).flatMap((element) => {
    const onClick = element.attributes.find((attribute) => attribute.name === 'onClick');
    const substitution = onClick?.expression
      ? platformSubstitutionFromClickExpression(element.tag, onClick.expression)
      : null;
    return onClick && substitution ? [{ attribute: onClick, substitution }] : [];
  });
  let nextSource = source;

  for (const match of [...matches].sort(
    (left, right) => right.attribute.start - left.attribute.start,
  )) {
    const attributes = platformAttributes(match.substitution);
    nextSource =
      attributes === ''
        ? removeSourceRangeWithLeadingWhitespace(
            nextSource,
            match.attribute.start,
            match.attribute.end,
          )
        : `${nextSource.slice(0, match.attribute.start)}${attributes}${nextSource.slice(match.attribute.end)}`;
  }

  return {
    source: nextSource,
    substitutions: matches.map((match) => match.substitution),
  };
}

function platformSubstitutionFromClickExpression(
  tag: string,
  expression: string,
): PlatformSubstitution | null {
  const detailsToggle =
    /^\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.open\s*=\s*!\s*document\.getElementById\(['"]\k<target>['"]\)!?\.open$/.exec(
      expression,
    );
  const detailsTarget = detailsToggle?.groups?.target;
  if (detailsTarget && tag === 'summary') {
    return {
      action: 'toggle',
      event: 'click',
      kind: 'details',
      tag,
      target: detailsTarget,
    };
  }

  const methodCall =
    /^\(\)\s*=>\s*document\.getElementById\(['"](?<target>[^'"]+)['"]\)!?\.(?<method>showModal|close|requestClose|showPopover|hidePopover|togglePopover)\(\)\s*$/.exec(
      expression,
    );
  const method = methodCall?.groups?.method;
  const target = methodCall?.groups?.target;
  if (!method || !target) return null;

  return platformSubstitutionFor(tag, target, method);
}

function removeSourceRangeWithLeadingWhitespace(
  source: string,
  start: number,
  end: number,
): string {
  let removeStart = start;
  while (removeStart > 0 && /\s/.test(source[removeStart - 1] ?? '')) {
    removeStart -= 1;
  }

  return `${source.slice(0, removeStart)}${source.slice(end)}`;
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
