import { escapeAttribute, escapeHtml } from '../html.js';
import type { MutationFail } from './definition.js';
import type { ValidationFailurePayload } from '../schema.js';

export function renderDefaultFailureFragmentContent(failure: MutationFail): string {
  if (failure.error.code === 'VALIDATION' && isValidationFailurePayload(failure.error.payload)) {
    return failure.error.payload.issues
      .map(
        (issue) =>
          `<output role="alert" data-error-path="${escapeAttribute(issue.path.join('.'))}">${escapeHtml(issue.message)}</output>`,
      )
      .join('');
  }

  return `<output role="alert" data-error-code="${escapeAttribute(failure.error.code)}">${escapeHtml(JSON.stringify(failure.error.payload))}</output>`;
}

export function renderDefaultFailurePage(failure: MutationFail): string {
  if (failure.error.code === 'VALIDATION' && isValidationFailurePayload(failure.error.payload)) {
    return `<!doctype html><html><body>${renderDefaultFailureFragmentContent(failure)}</body></html>`;
  }

  return `<!doctype html><html><body><output role="alert" data-error-code="${escapeAttribute(failure.error.code)}">${escapeHtml(JSON.stringify(failure.error.payload))}</output></body></html>`;
}

function isValidationFailurePayload(value: unknown): value is ValidationFailurePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'issues' in value &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        typeof issue === 'object' &&
        issue !== null &&
        'message' in issue &&
        typeof issue.message === 'string' &&
        'path' in issue &&
        Array.isArray(issue.path) &&
        issue.path.every((part: unknown) => typeof part === 'string'),
    )
  );
}
