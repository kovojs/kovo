import upstreamGetPriority from './property-priorities.js';

/** @internal Priority bucket compatible with StyleX's shorthand-before-longhand cascade model. */
export function getPriority(property: string): number {
  const cssProperty = property.startsWith('--') ? property : toKebabCase(property);
  return upstreamGetPriority(cssProperty);
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
