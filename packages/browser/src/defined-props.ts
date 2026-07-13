import {
  defineSecurityProperties,
  securityGetOwnPropertyDescriptor,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

export type DefinedProps<Props extends object> = {
  [Key in keyof Props]?: Exclude<Props[Key], undefined>;
};

export function definedProps<Props extends object>(props: Props): DefinedProps<Props> {
  // SPEC §6.6: this helper projects security-relevant loader/runtime options as well as
  // ordinary optional values. Dispatching through late-bound Object.entries/filter/fromEntries
  // lets an authored client module replace a compiler allowlist while the generated loader is
  // being installed. Snapshot enumerable own-data properties through boot-pinned controls.
  const result = securityNullRecord();
  const keys = securityObjectKeys(props);
  for (let index = 0; index < keys.length; index += 1) {
    const entry = securityOwnArrayEntry(keys, index);
    if (!entry.ok) throw new TypeError('Kovo option projection requires stable own-data keys.');
    const key = entry.value;
    const descriptor = securityGetOwnPropertyDescriptor(props, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Kovo option projection requires enumerable own-data properties.');
    }
    if (descriptor.value === undefined) continue;
    defineSecurityProperties(result, {
      [key]: {
        configurable: true,
        enumerable: true,
        value: descriptor.value,
        writable: true,
      },
    });
  }
  return result as DefinedProps<Props>;
}
