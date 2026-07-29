export function DevtoolRuntime$init(
  event: Event | undefined,
  context: { signal?: AbortSignal },
): void;
export function applyRuntimeFrame(scope: ParentNode, frame: unknown): boolean;
export function renderRecentRuntimeFrames(root: ParentNode, frames: readonly unknown[]): void;
export function runtimeFrameSummary(frame: unknown): string;
