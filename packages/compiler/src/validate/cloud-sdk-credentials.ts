import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';

export function validateCloudSdkCredentials(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const declaredProviders = new Set(options.registryFacts?.cloudMetadataProviders ?? []);
  if (declaredProviders.size === 0) return [];

  return model.cloudSdkClientConstructions
    .filter(
      (construction) =>
        declaredProviders.has(construction.provider) && !construction.hasCredentialOption,
    )
    .map((construction) =>
      diagnostics.at(
        'KV427',
        { length: construction.end - construction.start, start: construction.start },
        `${construction.constructorName} is imported from ${construction.moduleSpecifier}; add the declared cloud.${construction.provider} credential via credentials, credential, authClient, or the provider-specific credential option.`,
      ),
    );
}
