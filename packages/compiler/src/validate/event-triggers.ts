import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  return eventTriggerAttributes(model).flatMap((attribute) => {
    if (!isKnownEventOrTrigger(attribute.name)) {
      return [eventTriggerDiagnostic(diagnostics, 'KV212', attribute)];
    }

    if (attribute.name === 'load' && !hasKv211Justification(model, attribute.index)) {
      return [eventTriggerDiagnostic(diagnostics, 'KV211', attribute)];
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

function hasKv211Justification(model: ComponentModuleModel, index: number): boolean {
  // SPEC §5.2: consume the typed `justifiedDiagnostics` parser fact rather than re-scanning the raw
  // comment text for the KV211 code at validation time.
  return jsxComments(model).some(
    (comment) =>
      comment.attachedAttributeStart === index &&
      (comment.justifiedDiagnostics?.includes('KV211') ?? false),
  );
}

function eventTriggerDiagnostic(
  diagnostics: DiagnosticFactory,
  code: 'KV211' | 'KV212',
  attribute: { index: number; name: string },
): CompilerDiagnostic {
  return diagnostics.at(
    code,
    { start: attribute.index, length: attribute.name.length + 3 },
    `on:${attribute.name}`,
  );
}
