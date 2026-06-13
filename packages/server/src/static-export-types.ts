export interface StaticExportResponseSnapshot {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export interface StaticExportArtifact extends StaticExportResponseSnapshot {
  path: string;
}

export interface StaticExportClientModuleArtifact extends StaticExportResponseSnapshot {
  href: string;
  path: string;
}

export interface StaticExportAssetInput {
  contentType?: string;
  headers?: HeadersInit;
  path: string;
  source: string | URL;
}

export interface StaticExportAssetArtifact {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

export type StaticExportInventoryItem =
  | {
      headers: Record<string, string>;
      kind: 'route-document';
      path: string;
      status: number;
    }
  | {
      headers: Record<string, string>;
      href: string;
      kind: 'client-module';
      path: string;
      status: number;
    }
  | {
      headers: Record<string, string>;
      kind: 'static-asset';
      path: string;
      source: string;
      status: number;
    };

export interface StaticExportManifest {
  assets: readonly StaticExportManifestAsset[];
  clientModules: readonly StaticExportManifestClientModule[];
  files: readonly StaticExportInventoryItem[];
  routeDocuments: readonly StaticExportManifestRouteDocument[];
}

export interface StaticExportManifestRouteDocument {
  headers: Record<string, string>;
  path: string;
  status: number;
}

export interface StaticExportManifestClientModule {
  headers: Record<string, string>;
  href: string;
  path: string;
  status: number;
}

export interface StaticExportManifestAsset {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

export type StaticExportHtmlPathStyle = 'directory' | 'flat';
export type StaticExportNonExportablePolicy = 'error' | 'skip';

export interface StaticExportOptions {
  assets?: readonly StaticExportAssetInput[];
  diagnostics?: readonly import('./static-export-diagnostics.js').StaticExportCompileDiagnostic[];
  htmlPathStyle?: StaticExportHtmlPathStyle;
  onNonExportable?: StaticExportNonExportablePolicy;
  origin?: string;
  outDir?: string | URL;
}

export interface StaticExportResult {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly import('./static-export-diagnostics.js').StaticExportDiagnostic[];
}

// SPEC §9.5: dry-run export task wiring inspects the same route/module/asset set
// that a write export would publish, without reaching into replay internals.
export function staticExportInventory(result: {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}): StaticExportInventoryItem[] {
  return [
    ...result.artifacts.map((artifact) => ({
      headers: artifact.headers,
      kind: 'route-document' as const,
      path: artifact.path,
      status: artifact.status,
    })),
    ...result.clientModules.map((artifact) => ({
      headers: artifact.headers,
      href: artifact.href,
      kind: 'client-module' as const,
      path: artifact.path,
      status: artifact.status,
    })),
    ...result.assets.map((artifact) => ({
      headers: artifact.headers,
      kind: 'static-asset' as const,
      path: artifact.path,
      source: artifact.source,
      status: artifact.status,
    })),
  ];
}

// SPEC §9.5: export-task consumers need a stable public manifest for the
// directory-index documents, copied assets, and /c/ modules that replay would publish.
export function staticExportManifest(result: {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}): StaticExportManifest {
  const routeDocuments = result.artifacts.map((artifact) => ({
    headers: artifact.headers,
    path: artifact.path,
    status: artifact.status,
  }));
  const clientModules = result.clientModules.map((artifact) => ({
    headers: artifact.headers,
    href: artifact.href,
    path: artifact.path,
    status: artifact.status,
  }));
  const assets = result.assets.map((artifact) => ({
    headers: artifact.headers,
    path: artifact.path,
    source: artifact.source,
    status: artifact.status,
  }));

  return {
    assets,
    clientModules,
    files: staticExportInventory(result),
    routeDocuments,
  };
}

export function sortedHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}
