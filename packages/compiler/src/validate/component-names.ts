import { diagnosticDefinitions } from '@kovojs/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { type ComponentModel, type ComponentModuleModel, type SourceSpan } from '../scan/parse.js';
import { kebabCase } from '../shared.js';
import type { CompileComponentOptions } from '../types.js';

interface ComponentNameRegistration {
  component: ComponentModel;
  effectiveName: string;
  span: SourceSpan | null;
}

export function validateDuplicateComponentNames(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const byName = new Map<string, ComponentNameRegistration>();
  const registryNames = new Set(options.registryFacts?.components ?? []);

  for (const component of model.components) {
    const registration = componentNameRegistration(component);
    if (registryNames.has(registration.effectiveName)) {
      diagnostics.push(registryComponentNameDiagnostic(source, options.fileName, registration));
    }

    const previous = byName.get(registration.effectiveName);
    if (!previous) {
      byName.set(registration.effectiveName, registration);
      continue;
    }

    diagnostics.push(duplicateComponentNameDiagnostic(source, options.fileName, previous, registration));
  }

  return diagnostics;
}

function componentNameRegistration(component: ComponentModel): ComponentNameRegistration {
  const effectiveName = component.explicitName ?? kebabCase(component.localName ?? 'component');
  return {
    component,
    effectiveName,
    span: component.explicitNameSpan ?? component.localNameSpan ?? null,
  };
}

function duplicateComponentNameDiagnostic(
  source: string,
  fileName: string,
  first: ComponentNameRegistration,
  duplicate: ComponentNameRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV237;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnosticFor(
      fileName,
      'KV237',
      source,
      duplicateSpan?.start,
      duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    ),
    help: [
      definition.help,
      `Effective name: ${duplicate.effectiveName}`,
      `First definition: ${componentLabel(first.component)}`,
      `Duplicate definition: ${componentLabel(duplicate.component)}`,
      'SPEC §6.1.1 package prefixes remain the cross-package namespace mechanism; app-authored/vendored components in one module must not share an effective wire name.',
    ].join('\n'),
    message: `${definition.message} ${duplicate.effectiveName} is used by ${componentLabel(first.component)} and ${componentLabel(duplicate.component)}.`,
  };
}

function registryComponentNameDiagnostic(
  source: string,
  fileName: string,
  duplicate: ComponentNameRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV237;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnosticFor(
      fileName,
      'KV237',
      source,
      duplicateSpan?.start,
      duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    ),
    help: [
      definition.help,
      `Effective name: ${duplicate.effectiveName}`,
      `Registry definition: ${duplicate.effectiveName}`,
      `Duplicate definition: ${componentLabel(duplicate.component)}`,
      'SPEC §6.1.1 keeps effective names app-wide unique; registryFacts.components carries names already known to the app graph.',
    ].join('\n'),
    message: `${definition.message} ${duplicate.effectiveName} is already present in registry facts and is reused by ${componentLabel(duplicate.component)}.`,
  };
}

function componentLabel(component: ComponentModel): string {
  const local = component.localName ?? 'anonymous component';
  return component.explicitName ? `${local} component(${JSON.stringify(component.explicitName)})` : local;
}
