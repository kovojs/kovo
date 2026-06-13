import type { EventElementLike, EventTargetLike } from './events.js';
import type { EnhancedFormLike, UploadProgress } from './mutation-fetch.js';

export const enhancedMutationFormSelector = 'form[enhance],form[data-enhance],form[data-mutation]';

export interface EnhancedFormElementLike extends EventElementLike, EnhancedFormLike {
  submit?: () => void;
}

export function closestEnhancedMutationForm(
  target: EventTargetLike | undefined | null,
): EnhancedFormElementLike | null {
  const form = target?.closest?.(enhancedMutationFormSelector) as
    | EnhancedFormElementLike
    | null
    | undefined;
  return form && isEnhancedForm(form) ? form : null;
}

export function fallbackEnhancedMutationSubmit(form: EnhancedFormElementLike): void {
  if (typeof form.submit === 'function') {
    form.submit();
    return;
  }

  form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
  form.setAttribute?.('fw-error', '');
}

export function isEnhancedForm(form: EventElementLike): boolean {
  return (
    form.getAttribute('enhance') !== null ||
    form.getAttribute('data-enhance') !== null ||
    form.getAttribute('data-mutation') !== null
  );
}

export function updateUploadProgressElements(
  form: EventElementLike,
  progress: UploadProgress,
): void {
  const progressElements = form.querySelectorAll?.('[fw-upload-progress]') ?? [];
  const total = progress.total;
  const value =
    total !== undefined && total > 0
      ? Math.min(100, Math.round((progress.loaded / total) * 100))
      : undefined;

  for (const element of progressElements) {
    element.setAttribute('max', '100');
    if (value === undefined) {
      element.removeAttribute?.('value');
      continue;
    }
    element.setAttribute('value', String(value));
  }
}
