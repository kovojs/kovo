// eslint-disable-next-line no-control-regex -- KV439 intentionally neutralizes control chars.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;

function visibleControlEscape(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/**
 * SPEC §6.6 / KV439: log neutralization is a runtime defense-in-depth floor.
 * It keeps request-derived values from forging extra log lines or terminal controls.
 */
export function neutralizeLogValue(value: unknown): string {
  return String(value).replace(CONTROL_CHARACTER_PATTERN, visibleControlEscape);
}

export function formatLogMessage(strings: TemplateStringsArray, ...values: unknown[]): string {
  let message = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    message += neutralizeLogValue(values[index]) + (strings[index + 1] ?? '');
  }
  return neutralizeLogValue(message);
}
