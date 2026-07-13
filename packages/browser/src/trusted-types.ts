// SPEC §6.6: Trusted Types is browser runtime defense-in-depth, not the output proof. The
// controller below owns its policy reference in a module/installer-private closure, captures the
// host methods at boot, and checks that every minted value retains the exact reviewed bytes. The
// generated runtime and modular browser runtime use distinct CSP-admitted names so their private
// controllers can coexist without enabling duplicate-policy creation. A public realm property is
// never accepted as policy identity or cached authority (C221).

/**
 * Build boot-owned Trusted Types controls for one Kovo runtime installation.
 *
 * This declaration is intentionally closure-complete: `inline-loader-build.ts` extracts the same
 * implementation into the generated deferred runtime so modular and generated sinks share the
 * exact capture, witness, and per-write validation contract.
 *
 * @internal
 */
export function createKovoTrustedTypesSecurityControls(
  scope: typeof globalThis = globalThis,
  policyName: 'kovo' | 'kovo-browser' = 'kovo',
) {
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const nativeReflectApply = NativeReflect.apply;
  const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
  const factory = (scope as { trustedTypes?: object }).trustedTypes;
  const NativeTrustedHTML = (scope as { TrustedHTML?: { prototype: object } }).TrustedHTML;
  const NativeTrustedScriptURL = (scope as { TrustedScriptURL?: { prototype: object } })
    .TrustedScriptURL;

  function apply<Return>(method: Function, receiver: unknown, args: readonly unknown[]): Return {
    return nativeReflectApply(method, receiver, args) as Return;
  }

  function descriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
    return apply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
  }

  function valueMethod(value: object, property: PropertyKey): Function | undefined {
    const found = descriptor(value, property);
    return found && 'value' in found && typeof found.value === 'function' ? found.value : undefined;
  }

  function stableMethod(value: object, property: PropertyKey): Function | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const found = descriptor(owner, property);
      if (found !== undefined) {
        return 'value' in found && typeof found.value === 'function' ? found.value : undefined;
      }
      owner = apply(nativeGetPrototypeOf, NativeObject, [owner]);
    }
    return undefined;
  }

  const createPolicy = factory ? stableMethod(factory, 'createPolicy') : undefined;
  const isHTML = factory ? stableMethod(factory, 'isHTML') : undefined;
  const isScriptURL = factory ? stableMethod(factory, 'isScriptURL') : undefined;
  const trustedHtmlToString = NativeTrustedHTML
    ? valueMethod(NativeTrustedHTML.prototype, 'toString')
    : undefined;
  const trustedScriptUrlToString = NativeTrustedScriptURL
    ? valueMethod(NativeTrustedScriptURL.prototype, 'toString')
    : undefined;
  let policy: object | undefined;
  let policyCreateHTML: Function | undefined;
  let policyCreateScriptURL: Function | undefined;
  let htmlControlsVerified = false;
  let scriptUrlControlsVerified = false;

  function readTrustedHTML(value: unknown): string | undefined {
    if (
      !factory ||
      !isHTML ||
      !trustedHtmlToString ||
      value === null ||
      typeof value !== 'object'
    ) {
      return undefined;
    }
    try {
      if (apply<unknown>(isHTML, factory, [value]) !== true) return undefined;
      const content = apply<unknown>(trustedHtmlToString, value, []);
      return typeof content === 'string' ? content : undefined;
    } catch {
      return undefined;
    }
  }

  function exactTrustedHTML(value: unknown, expected: string): boolean {
    return readTrustedHTML(value) === expected;
  }

  function exactTrustedScriptURL(value: unknown, expected: string): boolean {
    if (
      !factory ||
      !isScriptURL ||
      !trustedScriptUrlToString ||
      value === null ||
      typeof value !== 'object'
    ) {
      return false;
    }
    try {
      return (
        apply<unknown>(isScriptURL, factory, [value]) === true &&
        apply<unknown>(trustedScriptUrlToString, value, []) === expected
      );
    } catch {
      return false;
    }
  }

  function controlsAreSound(): boolean {
    if (!factory) return true;
    if (
      !createPolicy ||
      !isHTML ||
      !trustedHtmlToString ||
      apply<number>((left: number, right: number) => left + right, undefined, [2, 3]) !== 5 ||
      descriptor({ marker: 'kovo-trusted-types-control' }, 'marker')?.value !==
        'kovo-trusted-types-control'
    ) {
      return false;
    }
    try {
      policy = apply<object>(createPolicy, factory, [
        policyName,
        {
          createHTML: (input: string) => input,
          createScriptURL: (input: string) => input,
        },
      ]);
      if (policy === null || typeof policy !== 'object') return false;
      policyCreateHTML = stableMethod(policy, 'createHTML');
      policyCreateScriptURL = stableMethod(policy, 'createScriptURL');
      if (!policyCreateHTML) return false;

      const htmlWitness = '<strong data-kovo-tt-control="html">exact</strong>';
      const htmlValue = apply<unknown>(policyCreateHTML, policy, [htmlWitness]);
      if (!exactTrustedHTML(htmlValue, htmlWitness)) return false;
      htmlControlsVerified = true;

      if (isScriptURL && trustedScriptUrlToString && policyCreateScriptURL) {
        const scriptUrlWitness = '/c/__v/kovo-trusted-types-control/runtime.js';
        const scriptUrlValue = apply<unknown>(policyCreateScriptURL, policy, [scriptUrlWitness]);
        if (!exactTrustedScriptURL(scriptUrlValue, scriptUrlWitness)) return false;
        scriptUrlControlsVerified = true;
      }

      let rejectedForeignFactory = false;
      let rejectedForeignPolicy = false;
      try {
        apply(createPolicy, {}, ['kovo-foreign-control', {}]);
      } catch {
        rejectedForeignFactory = true;
      }
      try {
        apply(policyCreateHTML, {}, [htmlWitness]);
      } catch {
        rejectedForeignPolicy = true;
      }
      return rejectedForeignFactory && rejectedForeignPolicy;
    } catch {
      // A preclaimed/blocked policy fails toward raw-string sinks. Under required Trusted Types,
      // the browser rejects that raw value instead of accepting an unowned policy's authority.
      policy = undefined;
      policyCreateHTML = undefined;
      policyCreateScriptURL = undefined;
      htmlControlsVerified = false;
      scriptUrlControlsVerified = false;
      return true;
    }
  }

  const controlsSound = controlsAreSound();

  function createHTML(input: string): string {
    if (!controlsSound || !htmlControlsVerified || !policy || !policyCreateHTML) return input;
    const value = apply<unknown>(policyCreateHTML, policy, [input]);
    if (!exactTrustedHTML(value, input)) {
      throw new TypeError('Kovo Trusted Types HTML control changed reviewed output bytes.');
    }
    return value as string;
  }

  function createScriptURL(input: string): string {
    if (!controlsSound || !scriptUrlControlsVerified || !policy || !policyCreateScriptURL) {
      return input;
    }
    const value = apply<unknown>(policyCreateScriptURL, policy, [input]);
    if (!exactTrustedScriptURL(value, input)) {
      throw new TypeError('Kovo Trusted Types script-URL control changed reviewed output bytes.');
    }
    return value as string;
  }

  function readHTML(value: unknown): string | undefined {
    if (!controlsSound || !htmlControlsVerified) return undefined;
    return readTrustedHTML(value);
  }

  return { createHTML, createScriptURL, readHTML };
}

let trustedTypesControls = createKovoTrustedTypesSecurityControls(globalThis, 'kovo-browser');

/** Route framework-reviewed HTML through Kovo's boot-owned Trusted Types policy. @internal */
export function kovoCreateHTML(html: string): string {
  return trustedTypesControls.createHTML(html);
}

/** Route a framework-controlled script URL through the same private policy. @internal */
export function kovoCreateScriptURL(url: string): string {
  return trustedTypesControls.createScriptURL(url);
}

/** Read exact bytes from a platform-branded TrustedHTML through the boot-captured stringifier. */
export function kovoReadTrustedHTML(value: unknown): string | undefined {
  return trustedTypesControls.readHTML(value);
}

/** Reset the private controller against the current realm. Test-only. @internal */
export function __resetKovoTrustedTypePolicyForTest(): void {
  trustedTypesControls = createKovoTrustedTypesSecurityControls(globalThis, 'kovo-browser');
}
