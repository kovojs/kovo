export interface NavigationUrlFacts {
  hash: string;
  href: string;
  origin: string;
  pathname: string;
  search: string;
}

/**
 * Boot-pinned browser controls for navigation and authentication response decisions.
 *
 * SPEC §6.5/§8: applications share the browser realm with the loader, so mutable globals and
 * prototype methods are not an authority boundary. This closure captures the platform controls,
 * proves representative accepting/rejecting semantics, and keeps the inline-loader extraction
 * closure-complete (the generator extracts this declaration beside enhanced navigation).
 *
 * @internal
 */
export function createBrowserNavigationSecurityControls(scope: typeof globalThis = globalThis) {
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const NativeString = String;
  const NativeURL = URL;
  const NativeHeaders = scope.Headers;
  const NativeResponse = scope.Response;
  const NativeDOMParser = scope.DOMParser;
  const NativeFormData = scope.FormData;
  const NativeDocument = scope.Document;
  const NativeElement = scope.Element;
  const NativeDocumentFragment = scope.DocumentFragment;
  const nativeDecodeURIComponent = scope.decodeURIComponent;
  const nativeReflectApply = NativeReflect.apply;
  const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
  const nativeStringIndexOf = NativeString.prototype.indexOf;
  const nativeStringSlice = NativeString.prototype.slice;
  const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
  const nativeStringToUpperCase = NativeString.prototype.toUpperCase;
  const nativeStringTrim = NativeString.prototype.trim;
  const urlPrototype = NativeURL.prototype;
  const urlHref = getter(urlPrototype, 'href');
  const urlOrigin = getter(urlPrototype, 'origin');
  const urlPathname = getter(urlPrototype, 'pathname');
  const urlSearch = getter(urlPrototype, 'search');
  const urlHash = getter(urlPrototype, 'hash');
  const headersGet = NativeHeaders ? valueMethod(NativeHeaders.prototype, 'get') : undefined;
  const responsePrototype = NativeResponse?.prototype;
  const responseBody = responsePrototype ? getter(responsePrototype, 'body') : undefined;
  const responseHeaders = responsePrototype ? getter(responsePrototype, 'headers') : undefined;
  const responseOk = responsePrototype ? getter(responsePrototype, 'ok') : undefined;
  const responseRedirected = responsePrototype
    ? getter(responsePrototype, 'redirected')
    : undefined;
  const responseStatus = responsePrototype ? getter(responsePrototype, 'status') : undefined;
  const responseUrl = responsePrototype ? getter(responsePrototype, 'url') : undefined;
  const responseText = responsePrototype ? valueMethod(responsePrototype, 'text') : undefined;
  const domParserParse = NativeDOMParser
    ? valueMethod(NativeDOMParser.prototype, 'parseFromString')
    : undefined;
  const formDataGet = NativeFormData ? valueMethod(NativeFormData.prototype, 'get') : undefined;
  const documentQuerySelector = NativeDocument
    ? valueMethod(NativeDocument.prototype, 'querySelector')
    : undefined;
  const elementQuerySelector = NativeElement
    ? valueMethod(NativeElement.prototype, 'querySelector')
    : undefined;
  const fragmentQuerySelector = NativeDocumentFragment
    ? valueMethod(NativeDocumentFragment.prototype, 'querySelector')
    : undefined;
  const elementGetAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'getAttribute')
    : undefined;
  const locationObject = scope.location;
  const documentObject = scope.document;
  const documentBody = documentObject ? stableGetter(documentObject, 'body') : undefined;
  const documentElement = documentObject
    ? stableGetter(documentObject, 'documentElement')
    : undefined;
  const documentHead = documentObject ? stableGetter(documentObject, 'head') : undefined;
  const locationHash = locationObject ? stableGetter(locationObject, 'hash') : undefined;
  const locationHref = locationObject ? stableGetter(locationObject, 'href') : undefined;
  const locationOrigin = locationObject ? stableGetter(locationObject, 'origin') : undefined;
  const locationPathname = locationObject ? stableGetter(locationObject, 'pathname') : undefined;
  const locationSearch = locationObject ? stableGetter(locationObject, 'search') : undefined;
  const locationAssign = locationObject ? stableMethod(locationObject, 'assign') : undefined;
  const locationReload = locationObject ? stableMethod(locationObject, 'reload') : undefined;
  const locationHrefSetter = locationObject ? stableSetter(locationObject, 'href') : undefined;

  function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
    return nativeReflectApply(fn, receiver, args) as Return;
  }

  function descriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
    return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  }

  function prototypeOf(value: object): object | null {
    return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
  }

  function getter(value: object, property: PropertyKey): (() => unknown) | undefined {
    const found = descriptor(value, property);
    return typeof found?.get === 'function' ? found.get : undefined;
  }

  function valueMethod(value: object, property: PropertyKey): Function | undefined {
    const found = descriptor(value, property);
    return found && 'value' in found && typeof found.value === 'function' ? found.value : undefined;
  }

  function stableMethod(value: object, property: PropertyKey): Function | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const method = valueMethod(owner, property);
      if (method) return method;
      const found = descriptor(owner, property);
      if (found !== undefined) return undefined;
      owner = prototypeOf(owner);
    }
    return undefined;
  }

  function stableGetter(value: object, property: PropertyKey): (() => unknown) | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const found = descriptor(owner, property);
      if (found?.get) return found.get;
      if (found !== undefined) return undefined;
      owner = prototypeOf(owner);
    }
    return undefined;
  }

  function stableSetter(
    value: object,
    property: PropertyKey,
  ): ((value: string) => void) | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const found = descriptor(owner, property);
      if (found?.set) return found.set as (value: string) => void;
      if (found !== undefined) return undefined;
      owner = prototypeOf(owner);
    }
    return undefined;
  }

  function readOwnData(value: object, property: PropertyKey): unknown {
    const found = descriptor(value, property);
    return found && 'value' in found ? found.value : undefined;
  }

  function call<Return>(method: Function, receiver: unknown, args: readonly unknown[]): Return {
    if (!controlsSound) throw new TypeError('Kovo browser navigation controls are unavailable.');
    return apply(method, receiver, args);
  }

  function callPlatformOrCustom<Return>(
    value: object,
    platformMethods: readonly (Function | undefined)[],
    property: PropertyKey,
    args: readonly unknown[],
  ): Return | undefined {
    for (let index = 0; index < platformMethods.length; index += 1) {
      const method = platformMethods[index];
      if (!method) continue;
      try {
        return apply<Return>(method, value, args);
      } catch {}
    }
    const custom = stableMethod(value, property);
    if (!custom) return undefined;
    try {
      return apply<Return>(custom, value, args);
    } catch {
      return undefined;
    }
  }

  function queryOne(root: unknown, selector: string): Element | null {
    if (!controlsSound || root === null || typeof root !== 'object') return null;
    const value = callPlatformOrCustom<unknown>(
      root,
      [documentQuerySelector, elementQuerySelector, fragmentQuerySelector],
      'querySelector',
      [selector],
    );
    return value !== null && typeof value === 'object' ? (value as Element) : null;
  }

  function readAttribute(element: unknown, name: string): string | null {
    if (!controlsSound || element === null || typeof element !== 'object') return null;
    const value = callPlatformOrCustom<unknown>(element, [elementGetAttribute], 'getAttribute', [
      name,
    ]);
    return typeof value === 'string' ? value : null;
  }

  function readLocationString(
    property: 'hash' | 'href' | 'origin' | 'pathname' | 'search',
  ): string | undefined {
    if (!locationObject) return undefined;
    const fieldGetter =
      property === 'hash'
        ? locationHash
        : property === 'href'
          ? locationHref
          : property === 'origin'
            ? locationOrigin
            : property === 'pathname'
              ? locationPathname
              : locationSearch;
    let value: unknown;
    try {
      value = fieldGetter
        ? apply(fieldGetter, locationObject, [])
        : readOwnData(locationObject, property);
    } catch {
      return undefined;
    }
    return typeof value === 'string' ? value : undefined;
  }

  function readDocumentField(
    value: unknown,
    property: 'body' | 'documentElement' | 'head',
  ): object | undefined {
    if (!controlsSound || value === null || typeof value !== 'object') return undefined;
    const fieldGetter =
      property === 'body'
        ? documentBody
        : property === 'documentElement'
          ? documentElement
          : documentHead;
    if (fieldGetter) {
      try {
        const field = apply<unknown>(fieldGetter, value, []);
        if (field !== null && typeof field === 'object') return field;
      } catch {}
    }
    const field = readOwnData(value, property);
    return field !== null && typeof field === 'object' ? field : undefined;
  }

  function readUrlField(fieldGetter: (() => unknown) | undefined, value: URL): string {
    if (!fieldGetter) throw new TypeError('Kovo URL controls are unavailable.');
    const field = apply<unknown>(fieldGetter, value, []);
    if (typeof field !== 'string') throw new TypeError('Kovo URL controls returned invalid data.');
    return field;
  }

  function facts(value: URL): NavigationUrlFacts {
    return {
      hash: readUrlField(urlHash, value),
      href: readUrlField(urlHref, value),
      origin: readUrlField(urlOrigin, value),
      pathname: readUrlField(urlPathname, value),
      search: readUrlField(urlSearch, value),
    };
  }

  function parseUrl(value: string, base?: string): NavigationUrlFacts | undefined {
    if (!controlsSound || typeof value !== 'string') return undefined;
    try {
      return facts(base === undefined ? new NativeURL(value) : new NativeURL(value, base));
    } catch {
      return undefined;
    }
  }

  function currentUrl(): NavigationUrlFacts | undefined {
    const href = readLocationString('href');
    if (!href) return undefined;
    const parsed = parseUrl(href);
    if (!parsed) return undefined;
    const claimedOrigin = readLocationString('origin');
    if (claimedOrigin !== undefined && claimedOrigin !== parsed.origin) return undefined;
    return parsed;
  }

  function lower(value: string): string {
    return apply(nativeStringToLowerCase, value, []);
  }

  function upper(value: string): string {
    return apply(nativeStringToUpperCase, value, []);
  }

  function trim(value: string): string {
    return apply(nativeStringTrim, value, []);
  }

  function indexOf(value: string, search: string): number {
    return apply(nativeStringIndexOf, value, [search]);
  }

  function slice(value: string, start: number, end?: number): string {
    return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
  }

  function charCode(value: string, index: number): number {
    return apply(nativeStringCharCodeAt, value, [index]);
  }

  function hasUnsafePathCode(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const code = charCode(value, index);
      if (value[index] === '\\' || code <= 0x20 || code === 0x7f) return true;
    }
    return false;
  }

  function decodeComponent(value: string): string | undefined {
    if (!controlsSound || typeof value !== 'string') return undefined;
    try {
      const decoded = apply<unknown>(nativeDecodeURIComponent, undefined, [value]);
      return typeof decoded === 'string' ? decoded : undefined;
    } catch {
      return undefined;
    }
  }

  function safeSameOriginPath(value: unknown): string | undefined {
    if (
      !controlsSound ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value[0] !== '/' ||
      value[1] === '/' ||
      value[1] === '\\' ||
      hasUnsafePathCode(value)
    ) {
      return undefined;
    }
    let decoded: string;
    try {
      decoded = apply(nativeDecodeURIComponent, undefined, [value]);
    } catch {
      return undefined;
    }
    if (
      decoded.length === 0 ||
      decoded[0] !== '/' ||
      decoded[1] === '/' ||
      decoded[1] === '\\' ||
      hasUnsafePathCode(decoded)
    ) {
      return undefined;
    }
    const location = currentUrl();
    if (!location) return value;
    const parsed = location ? parseUrl(value, location.href) : undefined;
    return !parsed || parsed.origin !== location.origin ? undefined : value;
  }

  function isHtmlContentType(value: unknown): boolean {
    if (!controlsSound || typeof value !== 'string') return false;
    const separator = indexOf(value, ';');
    const mediaType = lower(trim(separator < 0 ? value : slice(value, 0, separator)));
    return mediaType === 'text/html';
  }

  function isTrimmedAsciiEqual(value: unknown, expectedLowercase: string): boolean {
    return controlsSound && typeof value === 'string' && lower(trim(value)) === expectedLowercase;
  }

  function readFormDataValue(formData: unknown, name: string): unknown {
    if (!controlsSound || formData === null || typeof formData !== 'object') return undefined;
    if (formDataGet) {
      try {
        return apply(formDataGet, formData, [name]);
      } catch {}
    }
    const customGet = stableMethod(formData, 'get');
    if (!customGet) return undefined;
    try {
      return apply(customGet, formData, [name]);
    } catch {
      return undefined;
    }
  }

  function readHeaders(response: object): object | undefined {
    if (responseHeaders) {
      try {
        const value = apply<unknown>(responseHeaders, response, []);
        if (value !== null && typeof value === 'object') return value;
      } catch {}
    }
    const value = readOwnData(response, 'headers');
    return value !== null && typeof value === 'object' ? value : undefined;
  }

  function readHeader(response: unknown, name: string): string | undefined {
    if (!controlsSound || response === null || typeof response !== 'object') return undefined;
    const headers = readHeaders(response);
    if (!headers) return undefined;
    let value: unknown;
    try {
      if (headersGet) {
        try {
          value = apply(headersGet, headers, [name]);
        } catch {
          value = undefined;
        }
      }
      if (value === undefined) {
        const customGet = stableMethod(headers, 'get');
        if (!customGet) return undefined;
        value = apply(customGet, headers, [name]);
      }
    } catch {
      return undefined;
    }
    return typeof value === 'string' ? value : undefined;
  }

  function readResponseField(
    response: unknown,
    field: 'body' | 'ok' | 'redirected' | 'status' | 'url',
  ): unknown {
    if (!controlsSound || response === null || typeof response !== 'object') return undefined;
    const fieldGetter =
      field === 'body'
        ? responseBody
        : field === 'ok'
          ? responseOk
          : field === 'redirected'
            ? responseRedirected
            : field === 'status'
              ? responseStatus
              : responseUrl;
    if (fieldGetter) {
      try {
        return apply(fieldGetter, response, []);
      } catch {}
    }
    return readOwnData(response, field);
  }

  async function readResponseText(response: unknown): Promise<string> {
    if (!controlsSound || response === null || typeof response !== 'object') {
      throw new TypeError('Kovo navigation response is invalid.');
    }
    let method = responseText;
    if (method) {
      try {
        const value = await apply<Promise<unknown>>(method, response, []);
        if (typeof value !== 'string') throw new TypeError('Kovo response text is invalid.');
        return value;
      } catch (error) {
        if (responseHeaders) {
          try {
            apply(responseHeaders, response, []);
            throw error;
          } catch (brandError) {
            if (brandError === error) throw error;
          }
        }
      }
    }
    method = stableMethod(response, 'text');
    if (!method) throw new TypeError('Kovo navigation response text is unavailable.');
    const value = await apply<Promise<unknown>>(method, response, []);
    if (typeof value !== 'string') throw new TypeError('Kovo response text is invalid.');
    return value;
  }

  function parseHtmlDocument(value: string): Document | undefined {
    if (!controlsSound || !NativeDOMParser || !domParserParse) return undefined;
    try {
      const parsed = apply<unknown>(domParserParse, new NativeDOMParser(), [value, 'text/html']);
      return parsed !== null && typeof parsed === 'object' ? (parsed as Document) : undefined;
    } catch {
      return undefined;
    }
  }

  async function fetchDocument(href: string, accept: string): Promise<unknown> {
    const currentFetch = scope.fetch;
    if (!controlsSound || typeof currentFetch !== 'function') {
      throw new TypeError('Kovo navigation fetch is unavailable.');
    }
    return apply<Promise<unknown>>(currentFetch, scope, [href, { headers: { Accept: accept } }]);
  }

  async function fetchValue(input: string, init: object): Promise<unknown> {
    const currentFetch = scope.fetch;
    if (!controlsSound || typeof currentFetch !== 'function') {
      throw new TypeError('Kovo navigation fetch is unavailable.');
    }
    return apply<Promise<unknown>>(currentFetch, scope, [input, init]);
  }

  function assignRaw(value: string): boolean {
    if (!controlsSound || !locationObject) return false;
    try {
      if (locationAssign) {
        apply(locationAssign, locationObject, [value]);
        return true;
      }
      if (locationHrefSetter) {
        apply(locationHrefSetter, locationObject, [value]);
        return true;
      }
    } catch {}
    return false;
  }

  function hardNavigate(value: string): boolean {
    const location = currentUrl();
    const parsed = location ? parseUrl(value, location.href) : undefined;
    return parsed ? assignRaw(parsed.href) : false;
  }

  function navigateSameOrigin(value: string, fallback = '/'): boolean {
    const location = currentUrl();
    if (!location) {
      const safePath = safeSameOriginPath(value);
      return assignRaw(safePath ?? '/');
    }
    const parsed = location ? parseUrl(value, location.href) : undefined;
    if (location && parsed && parsed.origin === location.origin) {
      return assignRaw(value);
    }
    const safeFallback = safeSameOriginPath(fallback) ?? '/';
    return assignRaw(safeFallback);
  }

  function currentPathTarget(): string | undefined {
    const location = currentUrl();
    return location ? location.pathname + location.search + location.hash : undefined;
  }

  function reload(): boolean {
    if (!controlsSound || !locationObject || !locationReload) return false;
    try {
      apply(locationReload, locationObject, []);
      return true;
    } catch {
      return false;
    }
  }

  function controlsAreSound(): boolean {
    try {
      if (
        typeof nativeReflectApply !== 'function' ||
        typeof nativeObjectGetOwnPropertyDescriptor !== 'function' ||
        typeof nativeObjectGetPrototypeOf !== 'function' ||
        typeof nativeDecodeURIComponent !== 'function' ||
        !urlHref ||
        !urlOrigin ||
        !urlPathname ||
        !urlSearch ||
        !urlHash
      ) {
        return false;
      }
      if (apply<number>((left: number, right: number) => left + right, undefined, [2, 3]) !== 5) {
        return false;
      }
      const control = facts(new NativeURL('/safe?q=1#hash', 'https://kovo.test/base'));
      const crossOrigin = facts(new NativeURL('https://evil.example/phish'));
      if (
        control.href !== 'https://kovo.test/safe?q=1#hash' ||
        control.origin !== 'https://kovo.test' ||
        control.pathname !== '/safe' ||
        control.search !== '?q=1' ||
        control.hash !== '#hash' ||
        crossOrigin.origin !== 'https://evil.example'
      ) {
        return false;
      }
      if (
        lower('TEXT/HTML') !== 'text/html' ||
        upper('post') !== 'POST' ||
        trim(' text/html \t') !== 'text/html' ||
        indexOf('text/html; charset=utf-8', ';') !== 9 ||
        slice('/safe', 0, 1) !== '/' ||
        charCode('\\', 0) !== 0x5c ||
        apply(nativeDecodeURIComponent, undefined, ['/%5Cevil.example']) !== '/\\evil.example' ||
        apply(nativeDecodeURIComponent, undefined, ['/%2F%2Fevil.example']) !== '///evil.example'
      ) {
        return false;
      }
      if (NativeHeaders && headersGet) {
        const headers = new NativeHeaders({ 'X-Kovo-Control': 'yes' });
        if (
          apply(headersGet, headers, ['x-kovo-control']) !== 'yes' ||
          apply(headersGet, headers, ['x-kovo-missing']) !== null
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  const controlsSound = controlsAreSound();
  if (!controlsSound) {
    throw new TypeError(
      'Kovo browser navigation controls are unavailable because realm intrinsics were modified before runtime initialization.',
    );
  }

  return {
    call,
    currentPathTarget,
    currentUrl,
    decodeComponent,
    fetchDocument,
    fetchValue,
    hardNavigate,
    isHtmlContentType,
    isTrimmedAsciiEqual,
    navigateSameOrigin,
    parseHtmlDocument,
    parseUrl,
    queryOne,
    readAttribute,
    readHeader,
    readFormDataValue,
    readDocumentField,
    readResponseField,
    readResponseText,
    reload,
    safeSameOriginPath,
    upper,
  };
}
