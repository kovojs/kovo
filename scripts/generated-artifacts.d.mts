export const GENERATED_ARTIFACT_GENERATORS: Readonly<{
  cliSemanticCommandRequest: string;
  componentCatalog: string;
  diagnosticRegistry: string;
  frameworkExportPosture: string;
  icons: string;
  prodEmit: string;
  uiRegistry: string;
}>;

export function generatedArtifactGeneratorCheckCommand(
  generatorId: string,
): readonly [string, ...string[]];
