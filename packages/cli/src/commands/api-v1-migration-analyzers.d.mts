export interface ApiV1MigrationRefusal {
  readonly category: string;
  readonly end: number;
  readonly reason?: string;
  readonly start: number;
}

export type ApiV1MigrationAnalysis =
  | { readonly status: 'unchanged' }
  | { readonly source: string; readonly status: 'rewritten' }
  | {
      readonly refusals: readonly ApiV1MigrationRefusal[];
      readonly status: 'refused';
    };

export type ApiV1MigrationAnalyzer = (input: {
  readonly fileName: string;
  readonly source: string;
}) => ApiV1MigrationAnalysis;

export const analyzeBetterAuthApiV1Migration: ApiV1MigrationAnalyzer;
export const analyzeBrowserAuthoringV1Migration: ApiV1MigrationAnalyzer;
export const analyzeBrowserClientInstallerV1Migration: ApiV1MigrationAnalyzer;
export const analyzeBrowserInlineOptimismV1Migration: ApiV1MigrationAnalyzer;
export const analyzeCoreApiV1Migration: ApiV1MigrationAnalyzer;
export const analyzeDrizzleApiV1Migration: ApiV1MigrationAnalyzer;
export const analyzeServerApiV1Migration: ApiV1MigrationAnalyzer;
export const analyzeTestHarnessV2Migration: ApiV1MigrationAnalyzer;
export const analyzeUiHeadlessIconsV1Migration: ApiV1MigrationAnalyzer;
