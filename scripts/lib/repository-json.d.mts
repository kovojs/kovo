interface RepositoryJsonFormatResult {
  readonly code: string;
  readonly errors: ReadonlyArray<{ readonly message?: string | null }>;
}

interface RepositoryJsonFormatOptions {
  readonly format?: (
    fileName: string,
    source: string,
    options: Readonly<Record<string, unknown>>,
  ) => Promise<RepositoryJsonFormatResult>;
}

/** Serialize JSON with the same pinned formatter contract enforced by `vp check`. */
export function formatRepositoryJson(
  fileName: string,
  value: unknown,
  options?: RepositoryJsonFormatOptions,
): Promise<string>;
