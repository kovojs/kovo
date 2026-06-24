import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';

export function validateCloudSdkCredentials(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const declaredProviders = new Set([
    ...(options.registryFacts?.cloudMetadataProviders ?? []),
    ...model.cloudMetadataProviderDeclarations.map((declaration) => declaration.provider),
  ]);
  return [
    ...model.cloudSdkClientConstructions
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
      ),
    ...model.cloudCredentialReferences
      .filter((reference) => !declaredProviders.has(reference.provider))
      .map((reference) =>
        diagnostics.at(
          'KV427',
          { length: reference.end - reference.start, start: reference.start },
          `cloud.${reference.provider} is only available when the app shell declares createApp({ cloud: { ${reference.provider}: ... } }). Add the provider declaration or use an explicit non-metadata credential.`,
        ),
      ),
  ];
}
