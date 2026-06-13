export interface CompilerDiagnosticLike {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
  [field: string]: unknown;
}

export interface CompilerDiagnosticFact {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
}

export interface CompilerUpdateCoverageLike {
  component?: string;
  componentName?: string;
  detail?: string;
  position: string;
  query: string;
  status: string;
  [field: string]: unknown;
}

export interface CompilerUpdateCoverageFact {
  component: string;
  detail?: string;
  position: string;
  query: string;
  status: string;
}

export interface CompilerQueryUpdatePlanLike {
  componentName: string;
  paths: readonly string[];
  query: string;
  templateStamps?: readonly CompilerTemplateStampLike[];
  [field: string]: unknown;
}

export interface CompilerTemplateStampLike {
  itemBindingPlaceholders?: readonly CompilerTemplateStampPlaceholderLike[];
  itemBindings?: readonly string[];
  key: string;
  list: string;
  listReadPath?: string;
  selector: string;
  template: string;
  [field: string]: unknown;
}

export interface CompilerTemplateStampPlaceholderLike {
  path: string;
  readPath?: string;
  value: string;
  [field: string]: unknown;
}

export interface CompilerQueryUpdatePlanFact {
  componentName: string;
  paths: string[];
  query: string;
  templateStamps: CompilerTemplateStampFact[];
}

export interface CompilerTemplateStampFact {
  itemBindingPlaceholders: CompilerTemplateStampPlaceholderFact[];
  itemBindings: string[];
  key: string;
  list: string;
  listReadPath?: string;
  selector: string;
  template: string;
}

export interface CompilerTemplateStampPlaceholderFact {
  path: string;
  readPath?: string;
  value: string;
}

export type CompilerQueryShape =
  | string
  | readonly CompilerQueryShape[]
  | {
      kind?: string;
      shape?: CompilerQueryShape;
      [field: string]: unknown;
    };

export interface CompilerQueryShapeFact {
  query: string;
  shape: CompilerQueryShape;
  source: string;
}

export type CompilerDiagnosticMessageFact = Pick<
  CompilerDiagnosticFact,
  'code' | 'help' | 'message'
>;

export function compilerDiagnosticFacts(
  diagnostics: readonly CompilerDiagnosticLike[],
  codes?: readonly string[],
): CompilerDiagnosticFact[] {
  const codeSet = codes ? new Set(codes) : undefined;
  return diagnostics
    .filter((diagnostic) => codeSet === undefined || codeSet.has(diagnostic.code))
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.fileName === undefined ? {} : { fileName: diagnostic.fileName }),
      ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
      message: diagnostic.message,
      severity: diagnostic.severity,
    }));
}

export function compilerDiagnosticMessageFacts(
  diagnostics: readonly CompilerDiagnosticLike[],
  codes?: readonly string[],
): CompilerDiagnosticMessageFact[] {
  return compilerDiagnosticFacts(diagnostics, codes).map(({ code, help, message }) => ({
    code,
    ...(help === undefined ? {} : { help }),
    message,
  }));
}

export function compilerQueryUpdatePlanFacts(
  plans: readonly CompilerQueryUpdatePlanLike[],
): CompilerQueryUpdatePlanFact[] {
  return plans.map((plan) => ({
    componentName: plan.componentName,
    paths: [...plan.paths],
    query: plan.query,
    templateStamps: (plan.templateStamps ?? []).map((stamp) => ({
      itemBindingPlaceholders: (stamp.itemBindingPlaceholders ?? []).map((placeholder) => ({
        path: placeholder.path,
        ...(placeholder.readPath === undefined ? {} : { readPath: placeholder.readPath }),
        value: placeholder.value,
      })),
      itemBindings: [...(stamp.itemBindings ?? [])],
      key: stamp.key,
      list: stamp.list,
      ...(stamp.listReadPath === undefined ? {} : { listReadPath: stamp.listReadPath }),
      selector: stamp.selector,
      template: stamp.template,
    })),
  }));
}

export function compilerUpdateCoverageFacts(
  coverage: readonly CompilerUpdateCoverageLike[],
): CompilerUpdateCoverageFact[] {
  return coverage.map((entry) => ({
    component: entry.component ?? entry.componentName ?? '',
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    position: entry.position,
    query: entry.query,
    status: entry.status,
  }));
}

export function compilerGeneratedQueryShapeFact(options: {
  query: string;
  shape: CompilerQueryShape;
  source?: string;
}): CompilerQueryShapeFact {
  return {
    query: options.query,
    shape: options.shape,
    source: options.source ?? `generated/queries/${options.query}.shape.ts`,
  };
}
