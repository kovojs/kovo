interface MorphAbortState {
  aborted: string[];
  sideEffects: string[];
  starts: string[];
}

declare global {
  interface Window {
    __morphRemoveAborts?: MorphAbortState;
  }
}

function state(): MorphAbortState {
  window.__morphRemoveAborts ??= { aborted: [], sideEffects: [], starts: [] };
  return window.__morphRemoveAborts;
}

function setStatus(value: string): void {
  document.querySelector('[data-morph-abort-status]')?.replaceChildren(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startAbortable(_event: Event, ctx: { signal: AbortSignal }): Promise<void> {
  state().starts.push('abortable');
  setStatus('running');
  ctx.signal.addEventListener(
    'abort',
    () => {
      state().aborted.push('abortable');
      setStatus('aborted');
      window.dispatchEvent(new CustomEvent('kovo:morph-remove-abort'));
    },
    { once: true },
  );
  await delay(150);
  if (!ctx.signal.aborted) {
    state().sideEffects.push('late-handler');
    setStatus('late-handler');
  }
}

export function visibleSideEffect(): void {
  state().sideEffects.push('visible');
  setStatus('visible-fired');
}

export function touchReplacement(): void {
  state().starts.push('replacement');
  setStatus('replacement-touched');
}
