const NativeTypeError = globalThis.TypeError;

/** @internal Throw a framework-authored routing error outside the trusted plaintext zone. */
export function betterAuthCredentialRoutingFailure(message: string): never {
  throw new NativeTypeError(message);
}
