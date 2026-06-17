import { diagnosticDefinitions } from '@kovojs/core';

import { deriveComponentNames } from '../component-names.js';
import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  jsxElements,
  type ComponentModel,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type SourceSpan,
} from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';

interface ComponentNameRegistration {
  component: ComponentModel;
  domName: string;
  effectiveName: string;
  span: SourceSpan | null;
}

interface FragmentTargetRegistration {
  component: ComponentModel;
  targetName: string;
  span: SourceSpan | null;
}

interface ViewTransitionRegistration {
  attribute: JsxAttributeModel & { value: string };
  component: ComponentModel | null;
  element: JsxElementModel;
  name: string;
}

export function validateDuplicateComponentNames(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const byName = new Map<string, ComponentNameRegistration>();
  const registryNames = new Set(options.registryFacts?.components ?? []);
  const previousRegistryNames = new Set(options.previousRegistryFacts?.components ?? []);

  for (const component of model.components) {
    const registration = componentNameRegistration(component, options.fileName);
    if (registryNames.has(registration.effectiveName)) {
      diagnostics.push(registryComponentNameDiagnostic(source, options.fileName, registration));
    }
    if (
      previousRegistryNames.size > 0 &&
      !previousRegistryNames.has(registration.effectiveName)
    ) {
      const previousName = previousRegistryNameForDomLeaf(
        previousRegistryNames,
        registration.domName,
      );
      if (previousName) {
        diagnostics.push(
          changedComponentNameDiagnostic(source, options.fileName, previousName, registration),
        );
      }
    }

    const previous = byName.get(registration.effectiveName);
    if (!previous) {
      byName.set(registration.effectiveName, registration);
      continue;
    }

    diagnostics.push(
      duplicateComponentNameDiagnostic(source, options.fileName, previous, registration),
    );
  }

  return diagnostics;
}

export function validateDuplicateFragmentTargetNames(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const byName = new Map<string, FragmentTargetRegistration>();
  const registryNames = new Set(options.registryFacts?.fragmentTargets ?? []);

  for (const registration of fragmentTargetRegistrations(model, options.fileName)) {
    if (registryNames.has(registration.targetName)) {
      diagnostics.push(
        registryFragmentTargetNameDiagnostic(source, options.fileName, registration),
      );
    }

    const previous = byName.get(registration.targetName);
    if (!previous) {
      byName.set(registration.targetName, registration);
      continue;
    }

    diagnostics.push(
      duplicateFragmentTargetNameDiagnostic(source, options.fileName, previous, registration),
    );
  }

  return diagnostics;
}

export function validateDuplicateStaticViewTransitionNames(
  source: string,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const byName = new Map<string, ViewTransitionRegistration>();
  const registryNames = new Set(options.registryFacts?.viewTransitions ?? []);

  for (const registration of viewTransitionRegistrations(model)) {
    if (registryNames.has(registration.name)) {
      diagnostics.push(
        registryViewTransitionNameDiagnostic(source, options.fileName, registration),
      );
    }

    const previous = byName.get(registration.name);
    if (!previous) {
      byName.set(registration.name, registration);
      continue;
    }

    diagnostics.push(
      duplicateViewTransitionNameDiagnostic(source, options.fileName, previous, registration),
    );
  }

  return diagnostics;
}

function componentNameRegistration(
  component: ComponentModel,
  fileName: string,
): ComponentNameRegistration {
  const names = deriveComponentNames(fileName, component);
  return {
    component,
    domName: names.domName,
    effectiveName: names.registryKey,
    span: component.localNameSpan ?? null,
  };
}

function previousRegistryNameForDomLeaf(
  previousRegistryNames: ReadonlySet<string>,
  domName: string,
): string | null {
  for (const previousName of previousRegistryNames) {
    if (registryNameLeaf(previousName) === domName) return previousName;
  }
  return null;
}

function registryNameLeaf(registryName: string): string {
  return registryName.split('/').at(-1) ?? registryName;
}

function fragmentTargetRegistrations(
  model: ComponentModuleModel,
  fileName: string,
): FragmentTargetRegistration[] {
  return model.components.flatMap((component) => {
    if (component.options.find((option) => option.key === 'disableServerRefresh')?.staticValue === true) {
      return [];
    }

    const queries = component.options.find((option) => option.key === 'queries')?.objectEntries ?? [];
    if (queries.length === 0) return [];

    return [
      {
        component,
        span: component.localNameSpan ?? null,
        targetName: deriveComponentNames(fileName, component).registryKey,
      },
    ];
  });
}

function viewTransitionRegistrations(model: ComponentModuleModel): ViewTransitionRegistration[] {
  return jsxElements(model).flatMap((element) => {
    const attribute = element.attributes.find(
      (candidate): candidate is JsxAttributeModel & { value: string } =>
        candidate.name === 'viewTransitionName' && candidate.value !== undefined,
    );
    if (!attribute) return [];

    return [
      {
        attribute,
        component: componentForElement(model, element),
        element,
        name: attribute.value,
      },
    ];
  });
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

function changedComponentNameDiagnostic(
  source: string,
  fileName: string,
  previousName: string,
  current: ComponentNameRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV241;
  const span = current.span;
  return {
    ...diagnosticFor(
      fileName,
      'KV241',
      source,
      span?.start,
      span ? span.end - span.start : undefined,
    ),
    help: [
      definition.help,
      `Previous registry key: ${previousName}`,
      `Current registry key: ${current.effectiveName}`,
      `DOM leaf: ${current.domName}`,
      'Registry writer: previousRegistryFacts.components',
    ].join('\n'),
    message: `${definition.message} ${previousName} -> ${current.effectiveName}.`,
  };
}

function duplicateFragmentTargetNameDiagnostic(
  source: string,
  fileName: string,
  first: FragmentTargetRegistration,
  duplicate: FragmentTargetRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV238;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnosticFor(
      fileName,
      'KV238',
      source,
      duplicateSpan?.start,
      duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    ),
    help: [
      definition.help,
      `Fragment target: ${duplicate.targetName}`,
      `First writer: ${componentLabel(first.component)}`,
      `Duplicate writer: ${componentLabel(duplicate.component)}`,
      registryFragmentTargetSnapshot(duplicate.targetName),
    ].join('\n'),
    message: `${definition.message} ${duplicate.targetName} is used by ${componentLabel(first.component)} and ${componentLabel(duplicate.component)}.`,
  };
}

function registryFragmentTargetNameDiagnostic(
  source: string,
  fileName: string,
  duplicate: FragmentTargetRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV238;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnosticFor(
      fileName,
      'KV238',
      source,
      duplicateSpan?.start,
      duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    ),
    help: [
      definition.help,
      `Fragment target: ${duplicate.targetName}`,
      `Registry writer: registryFacts.fragmentTargets`,
      `Duplicate writer: ${componentLabel(duplicate.component)}`,
      registryFragmentTargetSnapshot(duplicate.targetName),
    ].join('\n'),
    message: `${definition.message} ${duplicate.targetName} is already present in registry facts and is reused by ${componentLabel(duplicate.component)}.`,
  };
}

function duplicateViewTransitionNameDiagnostic(
  source: string,
  fileName: string,
  first: ViewTransitionRegistration,
  duplicate: ViewTransitionRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV239;
  return {
    ...diagnosticFor(
      fileName,
      'KV239',
      source,
      duplicate.attribute.start,
      duplicate.attribute.end - duplicate.attribute.start,
    ),
    help: [
      definition.help,
      `View-transition name: ${duplicate.name}`,
      `First writer: ${viewTransitionLabel(first)}`,
      `Duplicate writer: ${viewTransitionLabel(duplicate)}`,
      registryViewTransitionSnapshot(duplicate.name),
      'Scope: module-local static rendered source plus registryFacts.viewTransitions when supplied; dynamic names require page-composition proof outside this validator.',
    ].join('\n'),
    message: `${definition.message} ${duplicate.name} is used by ${viewTransitionLabel(first)} and ${viewTransitionLabel(duplicate)}.`,
  };
}

function registryViewTransitionNameDiagnostic(
  source: string,
  fileName: string,
  duplicate: ViewTransitionRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV239;
  return {
    ...diagnosticFor(
      fileName,
      'KV239',
      source,
      duplicate.attribute.start,
      duplicate.attribute.end - duplicate.attribute.start,
    ),
    help: [
      definition.help,
      `View-transition name: ${duplicate.name}`,
      `Registry writer: registryFacts.viewTransitions`,
      `Duplicate writer: ${viewTransitionLabel(duplicate)}`,
      registryViewTransitionSnapshot(duplicate.name),
      'Scope: module-local static rendered source plus registryFacts.viewTransitions when supplied; dynamic names require page-composition proof outside this validator.',
    ].join('\n'),
    message: `${definition.message} ${duplicate.name} is already present in registry facts and is reused by ${viewTransitionLabel(duplicate)}.`,
  };
}

function componentLabel(component: ComponentModel): string {
  return component.localName ?? 'anonymous component';
}

function componentForElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
): ComponentModel | null {
  if (model.components.length === 1) return model.components[0] ?? null;

  return (
    model.components.find(
      (component) =>
        component.renderHost !== undefined &&
        element.start >= component.renderHost.start &&
        element.end <= component.renderHost.end,
    ) ?? null
  );
}

function viewTransitionLabel(registration: ViewTransitionRegistration): string {
  const component = registration.component ? `${componentLabel(registration.component)} ` : '';
  return `${component}<${registration.element.tag}>`;
}

function registryFragmentTargetSnapshot(targetName: string): string {
  return [
    `Would emit registry:`,
    `interface FragmentTargets {`,
    `  '${targetName}': ...;`,
    `}`,
  ].join('\n');
}

function registryViewTransitionSnapshot(name: string): string {
  return [`Would emit registry:`, `interface ViewTransitions {`, `  '${name}': unknown;`, `}`].join(
    '\n',
  );
}
