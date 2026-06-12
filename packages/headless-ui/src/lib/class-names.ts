export type ClassDictionary = Readonly<Record<string, boolean | null | undefined>>;
export type ClassArray = readonly ClassValue[];
export type ClassValue = string | ClassArray | ClassDictionary | false | null | undefined;

function collectClassTokens(value: ClassValue, tokens: string[]): void {
  if (!value) return;

  if (typeof value === 'string') {
    tokens.push(...value.trim().split(/\s+/).filter(Boolean));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectClassTokens(item, tokens);
    return;
  }

  for (const [className, enabled] of Object.entries(value)) {
    if (enabled) tokens.push(...className.trim().split(/\s+/).filter(Boolean));
  }
}

export function cn(...values: readonly ClassValue[]): string {
  const tokens: string[] = [];
  for (const value of values) collectClassTokens(value, tokens);

  return Array.from(new Set(tokens)).join(' ');
}
