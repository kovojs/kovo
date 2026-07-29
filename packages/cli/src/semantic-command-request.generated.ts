/**
 * Precise programmatic command union accepted by `runKovoCommand`.
 *
 * This source is generated from `command-schema.ts`; run
 * `pnpm generate:cli-command-request` after changing the semantic command AST.
 * Forms, arguments, options, enum literals, repeats, and boolean polarity are
 * schema-owned. Argv flag spellings are deliberately absent. Long-lived
 * `dev` and `mcp` processes stay executable-only until they have an explicit
 * abort/disposal contract.
 */
export type KovoSemanticCommandRequest =
  | {
      readonly arguments: {
        readonly components: readonly [
          (
            | 'accordion'
            | 'alert'
            | 'alert-dialog'
            | 'autocomplete'
            | 'avatar'
            | 'badge'
            | 'breadcrumb'
            | 'button'
            | 'card'
            | 'checkbox'
            | 'checkbox-group'
            | 'collapsible'
            | 'combobox'
            | 'command'
            | 'context-menu'
            | 'dialog'
            | 'disclosure'
            | 'drawer'
            | 'dropdown-menu'
            | 'field'
            | 'hover-card'
            | 'kbd'
            | 'menubar'
            | 'meter'
            | 'navigation-menu'
            | 'number-field'
            | 'otp-field'
            | 'popover'
            | 'progress'
            | 'radio-group'
            | 'scroll-area'
            | 'select'
            | 'separator'
            | 'sheet'
            | 'skeleton'
            | 'slider'
            | 'switch'
            | 'table'
            | 'tabs'
            | 'toast'
            | 'toggle'
            | 'toggle-group'
            | 'toolbar'
            | 'tooltip'
          ),
          ...(
            | 'accordion'
            | 'alert'
            | 'alert-dialog'
            | 'autocomplete'
            | 'avatar'
            | 'badge'
            | 'breadcrumb'
            | 'button'
            | 'card'
            | 'checkbox'
            | 'checkbox-group'
            | 'collapsible'
            | 'combobox'
            | 'command'
            | 'context-menu'
            | 'dialog'
            | 'disclosure'
            | 'drawer'
            | 'dropdown-menu'
            | 'field'
            | 'hover-card'
            | 'kbd'
            | 'menubar'
            | 'meter'
            | 'navigation-menu'
            | 'number-field'
            | 'otp-field'
            | 'popover'
            | 'progress'
            | 'radio-group'
            | 'scroll-area'
            | 'select'
            | 'separator'
            | 'sheet'
            | 'skeleton'
            | 'slider'
            | 'switch'
            | 'table'
            | 'tabs'
            | 'toast'
            | 'toggle'
            | 'toggle-group'
            | 'toolbar'
            | 'tooltip'
          )[],
        ];
      };
      readonly command: 'add';
      readonly form: 'components';
      readonly options?: {
        readonly out?: string;
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'audit';
      readonly form: 'audit';
      readonly options?: {
        readonly failOnFindings?: boolean;
      };
    }
  | {
      readonly arguments: {
        readonly appModule: string;
      };
      readonly command: 'build';
      readonly form: 'build';
      readonly options?: {
        readonly out?: string;
        readonly preset?: 'node' | 'vercel' | 'cloudflare';
        readonly check?: boolean;
        readonly cache?: boolean;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: { readonly [key: PropertyKey]: never };
      readonly command: 'check';
      readonly form: 'source-default';
      readonly options?: {
        readonly cache?: boolean;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly appModule?: string;
      };
      readonly command: 'check';
      readonly form: 'source';
      readonly options?: {
        readonly cache?: boolean;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly family?: 'optimistic' | 'coverage' | 'endpoint-posture' | 'sources-sinks';
        readonly graph?: string;
      };
      readonly command: 'check';
      readonly form: 'graph';
      readonly options?: {
        readonly format?: 'human' | 'json' | 'github';
        readonly artifact?: string;
      };
    }
  | {
      readonly arguments: {
        readonly deployment?: string;
      };
      readonly command: 'check';
      readonly form: 'environment';
      readonly options?: {
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'check';
      readonly form: 'advisories';
      readonly options?: {
        readonly feed?: string;
        readonly attestation?: string;
        readonly state?: string;
        readonly severityFloor?: 'low' | 'moderate' | 'high' | 'critical';
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly source: string;
      };
      readonly command: 'compile';
      readonly form: 'component';
      readonly options: {
        readonly out: string;
        readonly fileName?: string;
        readonly check?: boolean;
        readonly fixpoint?: boolean;
        readonly renderEquivalence?: boolean;
        readonly registryFacts?: string;
        readonly queryShapeFacts?: string;
        readonly factsOut?: string;
        readonly emitClientFiles?: boolean;
        readonly allowDiagnostic?: readonly string[];
      };
    }
  | {
      readonly arguments: {
        readonly source: string;
      };
      readonly command: 'compile';
      readonly form: 'route';
      readonly options: {
        readonly out: string;
        readonly fileName?: string;
        readonly artifactFileName?: string;
        readonly check?: boolean;
        readonly factsOut?: string;
        readonly rewrite?: readonly string[];
      };
    }
  | {
      readonly arguments: {
        readonly input: string;
      };
      readonly command: 'compile';
      readonly form: 'graph';
      readonly options: {
        readonly out: string;
        readonly check?: boolean;
      };
    }
  | {
      readonly arguments: {
        readonly source: string;
      };
      readonly command: 'compile';
      readonly form: 'mutation-inputs';
      readonly options: {
        readonly out: string;
        readonly fileName?: string;
        readonly check?: boolean;
      };
    }
  | {
      readonly arguments: {
        readonly input: string;
      };
      readonly command: 'compile';
      readonly form: 'drizzle-static';
      readonly options: {
        readonly out: string;
        readonly check?: boolean;
      };
    }
  | {
      readonly arguments: {
        readonly input: string;
      };
      readonly command: 'compile';
      readonly form: 'drizzle-optimistic';
      readonly options: {
        readonly out: string;
        readonly check?: boolean;
        readonly factsOut?: string;
      };
    }
  | {
      readonly arguments: {
        readonly package: string;
      };
      readonly command: 'compile';
      readonly form: 'package-css';
      readonly options: {
        readonly out: string;
        readonly check?: boolean;
        readonly entry?: string;
      };
    }
  | {
      readonly arguments: {
        readonly action: 'provision' | 'migrate' | 'generate' | 'check';
      };
      readonly command: 'db';
      readonly form: 'db';
      readonly options?: {
        readonly schema?: string;
        readonly migrations?: string;
        readonly driver?: 'pglite' | 'pg' | 'node-postgres';
        readonly databaseUrl?: string;
        readonly adminDatabaseUrl?: string;
        readonly systemDatabaseUrl?: string;
        readonly dataDir?: string;
        readonly readerRole?: string;
        readonly writerRole?: string;
      };
    }
  | {
      readonly arguments: {
        readonly task: string;
      };
      readonly command: 'docs';
      readonly form: 'docs';
      readonly options?: {
        readonly limit?: number;
        readonly format?: 'human' | 'json';
      };
    }
  | {
      readonly arguments: {
        readonly kind: 'component';
        readonly target: string;
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'target';
      readonly options?: {
        readonly optimistic?: false;
        readonly layouts?: false;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly kind: 'mutation';
        readonly target: string;
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'target';
      readonly options?: {
        readonly optimistic?: boolean;
        readonly layouts?: false;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly kind: 'query';
        readonly target: string;
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'target';
      readonly options?: {
        readonly optimistic?: false;
        readonly layouts?: false;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly kind: 'page';
        readonly target: string;
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'target';
      readonly options?: {
        readonly optimistic?: false;
        readonly layouts?: boolean;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly kind: 'context';
        readonly target: string;
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'target';
      readonly options?: {
        readonly optimistic?: false;
        readonly layouts?: false;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly kind: 'task';
        readonly target: string;
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'target';
      readonly options?: {
        readonly optimistic?: false;
        readonly layouts?: false;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'document';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'sources-sinks';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'tasks';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'agent';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'grants';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'endpoints';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'revealed';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'trust';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'capabilities';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'cookies';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'authorization';
      readonly options?: {
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'access';
      readonly options?: {
        readonly failOnFindings?: boolean;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'unguarded';
      readonly options?: {
        readonly failOnFindings?: boolean;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly graph?: string;
      };
      readonly command: 'explain';
      readonly form: 'unscoped';
      readonly options?: {
        readonly failOnFindings?: boolean;
        readonly artifact?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: { readonly [key: PropertyKey]: never };
      readonly command: 'explain';
      readonly form: 'auth-lifecycle';
      readonly options?: {
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: { readonly [key: PropertyKey]: never };
      readonly command: 'explain';
      readonly form: 'model-boundaries';
      readonly options?: {
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly url: string;
      };
      readonly command: 'explain';
      readonly form: 'attest';
      readonly options: {
        readonly artifact: string;
        readonly trustAnchor: string;
        readonly escapeReviews?: string;
        readonly escapeCensusReviews?: string;
        readonly format?: 'human' | 'json' | 'github';
      };
    }
  | {
      readonly arguments: {
        readonly appModule: string;
      };
      readonly command: 'export';
      readonly form: 'export';
      readonly options?: {
        readonly vite?: boolean;
        readonly root?: string;
        readonly out?: string;
        readonly origin?: string;
        readonly assetBase?: string;
        readonly skipNonExportable?: boolean;
      } & (
        | {
            readonly manifest?: never;
            readonly dist?: never;
          }
        | {
            readonly manifest: string;
            readonly dist: string;
          }
      );
    }
  | {
      readonly arguments: {
        readonly source: string;
      };
      readonly command: 'fix';
      readonly form: 'source';
      readonly options?: {
        readonly check?: boolean;
      };
    }
  | {
      readonly arguments: { readonly [key: PropertyKey]: never };
      readonly command: 'fix';
      readonly form: 'cost-report';
      readonly options: {
        readonly costReport: true;
      };
    }
  | {
      readonly arguments: {
        readonly advisory: string;
      };
      readonly command: 'incident';
      readonly form: 'scope';
      readonly options: {
        readonly events: string;
      };
    }
  | {
      readonly arguments: { readonly [key: PropertyKey]: never };
      readonly command: 'update-docs';
      readonly form: 'update-docs';
      readonly options?: { readonly [key: PropertyKey]: never };
    };
