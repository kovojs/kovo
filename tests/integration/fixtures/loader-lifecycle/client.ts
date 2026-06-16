interface LoaderLifecycleWindowState {
  aborted: string[];
  starts: string[];
}

declare global {
  interface Window {
    __loaderLifecycle?: LoaderLifecycleWindowState;
  }
}

function state(): LoaderLifecycleWindowState {
  window.__loaderLifecycle ??= { aborted: [], starts: [] };
  return window.__loaderLifecycle;
}

function setStatus(value: string): void {
  document.querySelector('[data-lifecycle-status]')?.replaceChildren(value);
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export async function startLongTask(
  _event: Event,
  ctx: { signal: AbortSignal },
): Promise<void> {
  state().starts.push('primary');
  setStatus('primary-running');
  ctx.signal.addEventListener(
    'abort',
    () => {
      state().aborted.push('primary');
      setStatus('primary-aborted');
      window.dispatchEvent(new CustomEvent('kovo:loader-lifecycle-abort'));
    },
    { once: true },
  );
  await waitForAbort(ctx.signal);
}

export function startReplacementTask(_event: Event, ctx: { signal: AbortSignal }): void {
  state().starts.push('replacement');
  setStatus('replacement-running');
  ctx.signal.addEventListener(
    'abort',
    () => {
      state().aborted.push('replacement');
    },
    { once: true },
  );
}
