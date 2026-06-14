import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { jsxComments, jsxElements, type ComponentModuleModel } from '../scan/parse.js';

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

export function validateEventTriggerNames(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  return eventTriggerAttributes(model).flatMap((attribute) => {
    if (!isKnownEventOrTrigger(attribute.name)) {
      return [eventTriggerDiagnostic(fileName, source, 'FW212', attribute)];
    }

    if (attribute.name === 'load' && !hasFw211Justification(model, attribute.index)) {
      return [eventTriggerDiagnostic(fileName, source, 'FW211', attribute)];
    }

    return [];
  });
}

function eventTriggerAttributes(
  model: ComponentModuleModel,
): Array<{ index: number; name: string }> {
  return jsxElements(model).flatMap((element) =>
    element.attributes.flatMap((attribute) => {
      const name = attribute.executionTriggerName;
      return name === undefined ? [] : [{ index: attribute.start, name }];
    }),
  );
}

function isKnownEventOrTrigger(name: string): boolean {
  return declaredExecutionTriggers.has(name) || delegatedDomEvents.has(name);
}

function hasFw211Justification(model: ComponentModuleModel, index: number): boolean {
  // SPEC §5.2: consume the typed `justifiedDiagnostics` parser fact rather than re-scanning the raw
  // comment text for the FW211 code at validation time.
  return jsxComments(model).some(
    (comment) =>
      comment.attachedAttributeStart === index &&
      (comment.justifiedDiagnostics?.includes('FW211') ?? false),
  );
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
