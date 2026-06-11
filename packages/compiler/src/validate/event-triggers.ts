import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  jsxComments,
  jsxElements,
  parseComponentModule,
  type JsxCommentModel,
} from '../scan/parse.js';

const declaredExecutionTriggers = new Set(['idle', 'load', 'visible']);

const delegatedDomEvents = new Set([
  'beforeinput',
  'blur',
  'change',
  'click',
  'close',
  'contextmenu',
  'dblclick',
  'focus',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keyup',
  'pointercancel',
  'pointerdown',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'reset',
  'submit',
  'toggle',
]);

export function validateEventTriggerNames(source: string, fileName: string): CompilerDiagnostic[] {
  return eventTriggerAttributes(source).flatMap((attribute) => {
    if (!isKnownEventOrTrigger(attribute.name)) {
      return [eventTriggerDiagnostic(fileName, source, 'FW212', attribute)];
    }

    if (attribute.name === 'load' && !hasFw211Justification(source, attribute.index)) {
      return [eventTriggerDiagnostic(fileName, source, 'FW211', attribute)];
    }

    return [];
  });
}

function eventTriggerAttributes(source: string): Array<{ index: number; name: string }> {
  return jsxElements(parseComponentModule('component.tsx', source)).flatMap((element) =>
    element.attributes.flatMap((attribute) => {
      const name = eventTriggerName(attribute.name);
      return name === null ? [] : [{ index: attribute.start, name }];
    }),
  );
}

function eventTriggerName(attributeName: string): string | null {
  const match = /^on:(?<name>[a-z][a-z0-9-]*)$/.exec(attributeName);
  return match?.groups?.name ?? null;
}

function isKnownEventOrTrigger(name: string): boolean {
  return declaredExecutionTriggers.has(name) || delegatedDomEvents.has(name);
}

function hasFw211Justification(source: string, index: number): boolean {
  const comments = jsxComments(parseComponentModule('component.tsx', source))
    .filter((comment) => comment.end <= index && comment.text.includes('FW211'))
    .sort((left, right) => right.end - left.end);
  const nearest = comments[0];
  return nearest !== undefined && isAttachedJustificationGap(source, nearest, index);
}

function isAttachedJustificationGap(
  source: string,
  comment: JsxCommentModel,
  attributeIndex: number,
): boolean {
  return /^[\s<>"'=/\w:.-]*$/.test(source.slice(comment.end, attributeIndex));
}

function eventTriggerDiagnostic(
  fileName: string,
  source: string,
  code: 'FW211' | 'FW212',
  attribute: { index: number; name: string },
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, code, source, attribute.index, attribute.name.length + 3),
    message: `${diagnosticDefinitions[code].message} on:${attribute.name}`,
  };
}
