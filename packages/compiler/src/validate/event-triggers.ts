import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';

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
  return [...source.matchAll(/\bon:(?<name>[a-z][a-z0-9-]*)\s*=/g)].map((match) => ({
    index: match.index ?? 0,
    name: match.groups?.name ?? '',
  }));
}

function isKnownEventOrTrigger(name: string): boolean {
  return declaredExecutionTriggers.has(name) || delegatedDomEvents.has(name);
}

function hasFw211Justification(source: string, index: number): boolean {
  const prefix = source.slice(Math.max(0, index - 240), index);
  return /(?:\/\*[\s\S]*?FW211[\s\S]*?\*\/|\/\/[^\n]*FW211|<!--[\s\S]*?FW211[\s\S]*?-->)/.test(
    prefix,
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
