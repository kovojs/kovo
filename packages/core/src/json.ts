/** Any value that survives a JSON round-trip; the boundary type for island state and wire payloads (SPEC §4.1). */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
