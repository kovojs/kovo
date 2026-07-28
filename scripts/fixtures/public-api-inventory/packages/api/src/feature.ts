/** Feature fixture export. */
export interface Feature {
  readonly enabled: boolean;
}

/** Create a fixture feature. */
export function feature(): Feature {
  return { enabled: true };
}
