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

/** @internal */
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

/** @internal */
export interface StaticExportManifest {
  assets: readonly StaticExportManifestAsset[];
  clientModules: readonly StaticExportManifestClientModule[];
  files: readonly StaticExportInventoryItem[];
  routeDocuments: readonly StaticExportManifestRouteDocument[];
}

/** @internal */
export interface StaticExportManifestRouteDocument {
  headers: Record<string, string>;
  path: string;
  status: number;
}

/** @internal */
export interface StaticExportManifestClientModule {
  headers: Record<string, string>;
  href: string;
  path: string;
  status: number;
}

/** @internal */
export interface StaticExportManifestAsset {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

/**
 * Policy for `StaticExportOptions.onNonExportable`: `'error'` fails the export
 * when a route cannot be statically rendered, `'skip'` omits it (SPEC.md §12).
 */
export type StaticExportNonExportablePolicy = 'error' | 'skip';

/** Options for exporting a `KovoApp` request shell to static route documents. */
export interface StaticExportOptions {
  assets?: readonly StaticExportAssetInput[];
  diagnostics?: readonly import('./static-export-diagnostics.js').StaticExportCompileDiagnostic[];
  onNonExportable?: StaticExportNonExportablePolicy;
  origin?: string;
  outDir?: string | URL;
  /** URL pathname base used to map referenced public assets back to the local root (SPEC §9.5). */
  publicAssetBase?: string;
  /** Local directory containing Vite-copied public assets referenced by exported HTML (SPEC §9.5). */
  publicAssetRoot?: string | URL;
}

/** Static export output produced by `exportStaticApp()`. */
export interface StaticExportResult {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly import('./static-export-diagnostics.js').StaticExportDiagnostic[];
}
