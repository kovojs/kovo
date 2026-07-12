export interface NavigationUrlFacts {
  hash: string;
  href: string;
  origin: string;
  pathname: string;
  search: string;
}

/**
 * Boot-pinned browser controls for navigation, mutation decoding, and DOM response commits.
 *
 * SPEC §6.5/§6.6/§8/§9.1: applications share the browser realm with the loader, so mutable globals
 * and prototype methods are not an authority boundary. This closure captures the platform
 * controls, proves representative accepting/rejecting semantics, and keeps the inline-loader
 * extraction closure-complete (the generator extracts this declaration beside enhanced
 * navigation and mutation response handling).
 *
 * @internal
 */
export function createBrowserNavigationSecurityControls(scope: typeof globalThis = globalThis) {
  const NativeObject = Object;
  const NativeReflect = Reflect;
  const NativeRegExp = RegExp;
  const NativeString = String;
  const NativeURL = URL;
  const NativeHeaders = scope.Headers;
  const NativeResponse = scope.Response;
  const NativeDOMParser = scope.DOMParser;
  const NativeFormData = scope.FormData;
  const NativeDocument = scope.Document;
  const NativeElement = scope.Element;
  const NativeNode = scope.Node;
  const NativeDocumentFragment = scope.DocumentFragment;
  const NativeHTMLTemplateElement = scope.HTMLTemplateElement;
  const NativeHTMLCollection = scope.HTMLCollection;
  const NativeNodeList = scope.NodeList;
  const NativeNamedNodeMap = scope.NamedNodeMap;
  const NativeAttr = scope.Attr;
  const NativeTextDecoder = scope.TextDecoder;
  const NativeUint8Array = scope.Uint8Array;
  const nativeDecodeURIComponent = scope.decodeURIComponent;
  const nativeReflectApply = NativeReflect.apply;
  const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeRegExpExec = NativeRegExp.prototype.exec;
  const nativeRegExpTest = NativeRegExp.prototype.test;
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
  const elementQuerySelectorAll = NativeElement
    ? valueMethod(NativeElement.prototype, 'querySelectorAll')
    : undefined;
  const elementGetAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'getAttribute')
    : undefined;
  const elementHasAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'hasAttribute')
    : undefined;
  const elementRemoveAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'removeAttribute')
    : undefined;
  const elementAttributes = NativeElement
    ? getter(NativeElement.prototype, 'attributes')
    : undefined;
  const elementChildren = NativeElement ? getter(NativeElement.prototype, 'children') : undefined;
  const elementInnerHtmlSetter = NativeElement
    ? setter(NativeElement.prototype, 'innerHTML')
    : undefined;
  const elementTagName = NativeElement ? getter(NativeElement.prototype, 'tagName') : undefined;
  const elementOuterHtml = NativeElement ? getter(NativeElement.prototype, 'outerHTML') : undefined;
  const elementRemove = NativeElement ? valueMethod(NativeElement.prototype, 'remove') : undefined;
  const elementAppend = NativeElement ? valueMethod(NativeElement.prototype, 'append') : undefined;
  const elementPrepend = NativeElement
    ? valueMethod(NativeElement.prototype, 'prepend')
    : undefined;
  const elementReplaceChildren = NativeElement
    ? valueMethod(NativeElement.prototype, 'replaceChildren')
    : undefined;
  const elementReplaceWith = NativeElement
    ? valueMethod(NativeElement.prototype, 'replaceWith')
    : undefined;
  const nodeCloneNode = NativeNode ? valueMethod(NativeNode.prototype, 'cloneNode') : undefined;
  const nodeAppendChild = NativeNode ? valueMethod(NativeNode.prototype, 'appendChild') : undefined;
  const nodeChildNodes = NativeNode ? getter(NativeNode.prototype, 'childNodes') : undefined;
  const nodeContains = NativeNode ? valueMethod(NativeNode.prototype, 'contains') : undefined;
  const nodeIsConnected = NativeNode ? getter(NativeNode.prototype, 'isConnected') : undefined;
  const fragmentChildren = NativeDocumentFragment
    ? getter(NativeDocumentFragment.prototype, 'children')
    : undefined;
  const templateContent = NativeHTMLTemplateElement
    ? getter(NativeHTMLTemplateElement.prototype, 'content')
    : undefined;
  const htmlCollectionLength = NativeHTMLCollection
    ? getter(NativeHTMLCollection.prototype, 'length')
    : undefined;
  const htmlCollectionItem = NativeHTMLCollection
    ? valueMethod(NativeHTMLCollection.prototype, 'item')
    : undefined;
  const nodeListLength = NativeNodeList ? getter(NativeNodeList.prototype, 'length') : undefined;
  const nodeListItem = NativeNodeList ? valueMethod(NativeNodeList.prototype, 'item') : undefined;
  const namedNodeMapLength = NativeNamedNodeMap
    ? getter(NativeNamedNodeMap.prototype, 'length')
    : undefined;
  const namedNodeMapItem = NativeNamedNodeMap
    ? valueMethod(NativeNamedNodeMap.prototype, 'item')
    : undefined;
  const attrName = NativeAttr ? getter(NativeAttr.prototype, 'name') : undefined;
  const attrValue = NativeAttr ? getter(NativeAttr.prototype, 'value') : undefined;
  const documentCreateElement = NativeDocument
    ? valueMethod(NativeDocument.prototype, 'createElement')
    : undefined;
  const documentActiveElement = NativeDocument
    ? getter(NativeDocument.prototype, 'activeElement')
    : undefined;
  const elementSetAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'setAttribute')
    : undefined;
  const textDecoderDecode = NativeTextDecoder
    ? valueMethod(NativeTextDecoder.prototype, 'decode')
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

  function setter(value: object, property: PropertyKey): ((value: unknown) => void) | undefined {
    const found = descriptor(value, property);
    return typeof found?.set === 'function' ? found.set : undefined;
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

  function readDomProperty(
    value: object,
    property: PropertyKey,
    platformGetters: readonly (((...args: never[]) => unknown) | undefined)[],
  ): unknown {
    for (let index = 0; index < platformGetters.length; index += 1) {
      const fieldGetter = platformGetters[index];
      if (!fieldGetter) continue;
      try {
        return apply(fieldGetter, value, []);
      } catch {}
    }
    const own = readOwnData(value, property);
    if (own !== undefined) return own;
    const custom = stableGetter(value, property);
    if (!custom) return undefined;
    try {
      return apply(custom, value, []);
    } catch {
      return undefined;
    }
  }

  function snapshotIndexedCollection<T>(
    collection: unknown,
    lengthGetters: readonly (((...args: never[]) => unknown) | undefined)[],
    itemMethods: readonly (Function | undefined)[],
  ): T[] {
    if (!controlsSound || collection === null || typeof collection !== 'object') return [];
    const rawLength = readDomProperty(collection, 'length', lengthGetters);
    if (
      typeof rawLength !== 'number' ||
      rawLength < 0 ||
      rawLength > 100_000 ||
      rawLength % 1 !== 0
    ) {
      throw new TypeError('Kovo DOM collection length is invalid.');
    }
    const snapshot: T[] = [];
    for (let index = 0; index < rawLength; index += 1) {
      let entry: unknown;
      let read = false;
      for (let methodIndex = 0; methodIndex < itemMethods.length; methodIndex += 1) {
        const item = itemMethods[methodIndex];
        if (!item) continue;
        try {
          entry = apply(item, collection, [index]);
          read = true;
          break;
        } catch {}
      }
      if (!read) entry = readOwnData(collection, String(index));
      if (entry === null || entry === undefined) {
        throw new TypeError('Kovo DOM collection item is unavailable.');
      }
      snapshot[index] = entry as T;
    }
    return snapshot;
  }

  function snapshotChildNodes(value: object): ChildNode[] {
    const collection = readDomProperty(value, 'childNodes', [nodeChildNodes]);
    return snapshotIndexedCollection<ChildNode>(collection, [nodeListLength], [nodeListItem]);
  }

  function snapshotElementChildren(value: object): Element[] {
    const collection = readDomProperty(value, 'children', [elementChildren, fragmentChildren]);
    return snapshotIndexedCollection<Element>(
      collection,
      [htmlCollectionLength],
      [htmlCollectionItem],
    );
  }

  function snapshotElementAttributes(element: object): { name: string; value: string }[] {
    const collection = readDomProperty(element, 'attributes', [elementAttributes]);
    const attributes = snapshotIndexedCollection<object>(
      collection,
      [namedNodeMapLength],
      [namedNodeMapItem],
    );
    const snapshot: { name: string; value: string }[] = [];
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes[index];
      if (!attribute) continue;
      const name = readDomProperty(attribute, 'name', [attrName]);
      const value = readDomProperty(attribute, 'value', [attrValue]);
      if (typeof name !== 'string' || typeof value !== 'string') {
        throw new TypeError('Kovo DOM attribute snapshot is invalid.');
      }
      snapshot[snapshot.length] = { name, value };
    }
    return snapshot;
  }

  function queryAllElements(root: object, selector: string): Element[] {
    let collection: unknown;
    if (elementQuerySelectorAll) {
      try {
        collection = apply(elementQuerySelectorAll, root, [selector]);
      } catch {}
    }
    if (collection === undefined) {
      const custom = stableMethod(root, 'querySelectorAll');
      if (!custom) return [];
      collection = apply(custom, root, [selector]);
    }
    return snapshotIndexedCollection<Element>(collection, [nodeListLength], [nodeListItem]);
  }

  function readElementTagName(element: object): string | undefined {
    const value = readDomProperty(element, 'tagName', [elementTagName]);
    return typeof value === 'string' ? value : undefined;
  }

  function hasElementAttribute(element: object, name: string): boolean {
    const method = elementHasAttribute ?? stableMethod(element, 'hasAttribute');
    if (!method) throw new TypeError('Kovo DOM has-attribute control is unavailable.');
    return call<unknown>(method, element, [name]) === true;
  }

  function setElementAttribute(element: object, name: string, value: string): void {
    const method = elementSetAttribute ?? stableMethod(element, 'setAttribute');
    if (!method) throw new TypeError('Kovo DOM set-attribute control is unavailable.');
    call(method, element, [name, value]);
  }

  function removeElementAttribute(element: object, name: string): void {
    const method = elementRemoveAttribute ?? stableMethod(element, 'removeAttribute');
    if (!method) throw new TypeError('Kovo DOM remove-attribute control is unavailable.');
    call(method, element, [name]);
  }

  function elementContains(element: object, node: object | null): boolean {
    const method = nodeContains ?? stableMethod(element, 'contains');
    if (!method) throw new TypeError('Kovo DOM contains control is unavailable.');
    return call<unknown>(method, element, [node]) === true;
  }

  function createFragmentContent(html: string): DocumentFragment {
    if (!documentObject) throw new TypeError('Kovo DOM document control is unavailable.');
    const create = documentCreateElement ?? stableMethod(documentObject, 'createElement');
    if (!create) throw new TypeError('Kovo DOM template control is unavailable.');
    const template = call<unknown>(create, documentObject, ['template']);
    if (template === null || typeof template !== 'object') {
      throw new TypeError('Kovo DOM template creation returned invalid data.');
    }
    const write = elementInnerHtmlSetter ?? stableSetter(template, 'innerHTML');
    if (!write) throw new TypeError('Kovo DOM template HTML control is unavailable.');
    call(write, template, [html]);
    const content = readDomProperty(template, 'content', [templateContent]);
    if (content === null || typeof content !== 'object') {
      throw new TypeError('Kovo DOM template content is unavailable.');
    }
    return content as DocumentFragment;
  }

  function readDocumentActiveElement(): Element | null {
    if (!documentObject) return null;
    const value = readDomProperty(documentObject, 'activeElement', [documentActiveElement]);
    return value !== null && typeof value === 'object' ? (value as Element) : null;
  }

  function readNodeIsConnected(node: object): boolean {
    return readDomProperty(node, 'isConnected', [nodeIsConnected]) === true;
  }

  function cloneElement(element: unknown): Element | undefined {
    if (!controlsSound || element === null || typeof element !== 'object') return undefined;
    let value: unknown;
    if (nodeCloneNode) {
      try {
        value = apply(nodeCloneNode, element, [true]);
      } catch {
        return undefined;
      }
    } else {
      const custom = stableMethod(element, 'cloneNode');
      if (!custom) return undefined;
      try {
        value = apply(custom, element, [true]);
      } catch {
        return undefined;
      }
    }
    return value !== null && typeof value === 'object' ? (value as Element) : undefined;
  }

  function cloneDomNode(node: object, deep = false): Node {
    const method = nodeCloneNode ?? stableMethod(node, 'cloneNode');
    if (!method) throw new TypeError('Kovo DOM clone control is unavailable.');
    const value = call<unknown>(method, node, [deep]);
    if (value === null || typeof value !== 'object') {
      throw new TypeError('Kovo DOM clone control returned invalid data.');
    }
    return value as Node;
  }

  function removeElement(element: unknown): boolean {
    if (!controlsSound || element === null || typeof element !== 'object') return false;
    if (elementRemove) {
      try {
        apply(elementRemove, element, []);
        return true;
      } catch {
        return false;
      }
    }
    const custom = stableMethod(element, 'remove');
    if (!custom) return false;
    try {
      apply(custom, element, []);
      return true;
    } catch {
      return false;
    }
  }

  function readElementOuterHtml(element: unknown): string | undefined {
    if (!controlsSound || element === null || typeof element !== 'object') return undefined;
    let value: unknown;
    if (elementOuterHtml) {
      try {
        value = apply(elementOuterHtml, element, []);
      } catch {
        return undefined;
      }
    } else {
      const custom = stableGetter(element, 'outerHTML');
      if (custom) {
        try {
          value = apply(custom, element, []);
        } catch {
          return undefined;
        }
      } else {
        value = readOwnData(element, 'outerHTML');
      }
    }
    return typeof value === 'string' ? value : undefined;
  }

  function appendElementChildren(element: Element, nodes: readonly (Node | string)[]): void {
    const method = elementAppend ?? stableMethod(element, 'append');
    if (!method) throw new TypeError('Kovo DOM append control is unavailable.');
    call(method, element, nodes);
  }

  function prependElementChildren(element: Element, nodes: readonly (Node | string)[]): void {
    const method = elementPrepend ?? stableMethod(element, 'prepend');
    if (!method) throw new TypeError('Kovo DOM prepend control is unavailable.');
    call(method, element, nodes);
  }

  function replaceElement(current: Element, next: Element): void {
    const method = elementReplaceWith ?? stableMethod(current, 'replaceWith');
    if (!method) throw new TypeError('Kovo DOM replace control is unavailable.');
    call(method, current, [next]);
  }

  function replaceElementChildren(element: Element, nodes: readonly (Node | string)[]): void {
    const method = elementReplaceChildren ?? stableMethod(element, 'replaceChildren');
    if (!method) {
      throw new TypeError('Kovo DOM replace-children control is unavailable.');
    }
    call(method, element, nodes);
  }

  function createTextDecoder(): TextDecoder {
    if (!controlsSound || !NativeTextDecoder || !textDecoderDecode) {
      throw new TypeError('Kovo mutation stream decoder control is unavailable.');
    }
    return new NativeTextDecoder();
  }

  function decodeText(
    decoder: TextDecoder,
    input?: AllowSharedBufferSource,
    options?: TextDecodeOptions,
  ): string {
    if (!textDecoderDecode) {
      throw new TypeError('Kovo mutation stream decoder control is unavailable.');
    }
    const value = call<unknown>(
      textDecoderDecode,
      decoder,
      input === undefined ? [] : options === undefined ? [input] : [input, options],
    );
    if (typeof value !== 'string') {
      throw new TypeError('Kovo mutation stream decoder returned invalid data.');
    }
    return value;
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

  function regExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
    return apply(nativeRegExpExec, pattern, [value]);
  }

  function regExpTest(pattern: RegExp, value: string): boolean {
    return apply(nativeRegExpTest, pattern, [value]);
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
        typeof nativeRegExpExec !== 'function' ||
        typeof nativeRegExpTest !== 'function' ||
        typeof nativeDecodeURIComponent !== 'function' ||
        !urlHref ||
        !urlOrigin ||
        !urlPathname ||
        !urlSearch ||
        !urlHash ||
        !NativeTextDecoder ||
        !NativeUint8Array ||
        !textDecoderDecode
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
        regExpExec(/security-(control)/, 'kovo-security-control')?.[1] !== 'control' ||
        regExpExec(/security-(control)/, 'kovo-security-negative') !== null ||
        regExpTest(/^kovo-security-control$/, 'kovo-security-control') !== true ||
        regExpTest(/^kovo-security-control$/, 'kovo-security-negative') !== false ||
        apply(nativeDecodeURIComponent, undefined, ['/%5Cevil.example']) !== '/\\evil.example' ||
        apply(nativeDecodeURIComponent, undefined, ['/%2F%2Fevil.example']) !== '///evil.example'
      ) {
        return false;
      }
      const decoderControl = new NativeTextDecoder();
      const decoderBytes = new NativeUint8Array([
        60, 107, 111, 118, 111, 45, 100, 111, 110, 101, 32, 114, 101, 97, 115, 111, 110, 61, 34,
        115, 101, 99, 117, 114, 105, 116, 121, 45, 99, 111, 110, 116, 114, 111, 108, 34, 62, 60, 47,
        107, 111, 118, 111, 45, 100, 111, 110, 101, 62,
      ]);
      if (
        apply(textDecoderDecode, decoderControl, [decoderBytes, { stream: true }]) !==
          '<kovo-done reason="security-control"></kovo-done>' ||
        apply(textDecoderDecode, decoderControl, []) !== ''
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
      if (NativeDocument && NativeElement && NativeNode && documentObject) {
        if (
          !documentCreateElement ||
          !elementSetAttribute ||
          !elementGetAttribute ||
          !elementHasAttribute ||
          !elementRemoveAttribute ||
          !elementAttributes ||
          !elementChildren ||
          !elementInnerHtmlSetter ||
          !elementTagName ||
          !elementOuterHtml ||
          !elementRemove ||
          !elementAppend ||
          !elementPrepend ||
          !elementReplaceChildren ||
          !elementReplaceWith ||
          !nodeCloneNode ||
          !nodeAppendChild ||
          !nodeChildNodes ||
          !nodeContains ||
          !nodeIsConnected ||
          !fragmentChildren ||
          !templateContent ||
          !htmlCollectionLength ||
          !htmlCollectionItem ||
          !nodeListLength ||
          !nodeListItem ||
          !namedNodeMapLength ||
          !namedNodeMapItem ||
          !attrName ||
          !attrValue ||
          !documentActiveElement ||
          !elementQuerySelector ||
          !elementQuerySelectorAll
        ) {
          return false;
        }
        const snapshotControl = apply<unknown>(documentCreateElement, documentObject, ['section']);
        const nestedControl = apply<unknown>(documentCreateElement, documentObject, ['span']);
        const appendControl = apply<unknown>(documentCreateElement, documentObject, ['i']);
        const prependControl = apply<unknown>(documentCreateElement, documentObject, ['b']);
        const replacementControl = apply<unknown>(documentCreateElement, documentObject, [
          'article',
        ]);
        const templateControl = apply<unknown>(documentCreateElement, documentObject, ['template']);
        if (
          snapshotControl === null ||
          typeof snapshotControl !== 'object' ||
          nestedControl === null ||
          typeof nestedControl !== 'object' ||
          appendControl === null ||
          typeof appendControl !== 'object' ||
          prependControl === null ||
          typeof prependControl !== 'object' ||
          replacementControl === null ||
          typeof replacementControl !== 'object' ||
          templateControl === null ||
          typeof templateControl !== 'object'
        ) {
          return false;
        }
        apply(elementSetAttribute, snapshotControl, ['kovo-nav-segment', 'security-control']);
        apply(elementSetAttribute, nestedControl, ['kovo-nav-segment', 'nested-control']);
        apply(elementSetAttribute, nestedControl, ['kovo-fragment-target', 'security-live-target']);
        apply(elementSetAttribute, appendControl, ['data-kovo-commit', 'append']);
        apply(elementSetAttribute, prependControl, ['data-kovo-commit', 'prepend']);
        apply(elementSetAttribute, replacementControl, [
          'kovo-fragment-target',
          'security-live-target',
        ]);
        apply(nodeAppendChild, snapshotControl, [nestedControl]);
        apply(elementInnerHtmlSetter, templateControl, [
          '<strong data-kovo-template-control="yes">safe</strong>',
        ]);
        const templateFragment = apply<unknown>(templateContent, templateControl, []);
        if (templateFragment === null || typeof templateFragment !== 'object') return false;
        const templateChildren = apply<unknown>(fragmentChildren, templateFragment, []);
        const templateNodes = apply<unknown>(nodeChildNodes, templateFragment, []);
        if (
          templateChildren === null ||
          typeof templateChildren !== 'object' ||
          templateNodes === null ||
          typeof templateNodes !== 'object' ||
          apply<unknown>(htmlCollectionLength, templateChildren, []) !== 1 ||
          apply<unknown>(nodeListLength, templateNodes, []) !== 1
        ) {
          return false;
        }
        const templateChild = apply<unknown>(htmlCollectionItem, templateChildren, [0]);
        const templateNode = apply<unknown>(nodeListItem, templateNodes, [0]);
        if (
          templateChild === null ||
          typeof templateChild !== 'object' ||
          templateNode !== templateChild ||
          apply<unknown>(elementTagName, templateChild, []) !== 'STRONG' ||
          apply<unknown>(elementHasAttribute, templateChild, ['data-kovo-template-control']) !==
            true ||
          apply<unknown>(elementGetAttribute, templateChild, ['data-kovo-template-control']) !==
            'yes' ||
          apply<unknown>(nodeContains, templateFragment, [templateChild]) !== true ||
          apply<unknown>(nodeIsConnected, templateChild, []) !== false
        ) {
          return false;
        }
        const templateAttributes = apply<unknown>(elementAttributes, templateChild, []);
        if (templateAttributes === null || typeof templateAttributes !== 'object') return false;
        if (apply<unknown>(namedNodeMapLength, templateAttributes, []) !== 1) return false;
        const templateAttribute = apply<unknown>(namedNodeMapItem, templateAttributes, [0]);
        if (
          templateAttribute === null ||
          typeof templateAttribute !== 'object' ||
          apply<unknown>(attrName, templateAttribute, []) !== 'data-kovo-template-control' ||
          apply<unknown>(attrValue, templateAttribute, []) !== 'yes'
        ) {
          return false;
        }
        const descendants = apply<unknown>(elementQuerySelectorAll, snapshotControl, ['*']);
        if (
          descendants === null ||
          typeof descendants !== 'object' ||
          apply<unknown>(nodeListLength, descendants, []) !== 1 ||
          apply<unknown>(nodeListItem, descendants, [0]) !== nestedControl
        ) {
          return false;
        }
        apply(elementRemoveAttribute, templateChild, ['data-kovo-template-control']);
        if (apply<unknown>(elementHasAttribute, templateChild, ['data-kovo-template-control'])) {
          return false;
        }
        const expectedSnapshot =
          '<section kovo-nav-segment="security-control"><span kovo-nav-segment="nested-control" kovo-fragment-target="security-live-target"></span></section>';
        const expectedWithoutNested = '<section kovo-nav-segment="security-control"></section>';
        const expectedNested =
          '<span kovo-nav-segment="nested-control" kovo-fragment-target="security-live-target"></span>';
        const snapshotClone = apply<unknown>(nodeCloneNode, snapshotControl, [true]);
        if (
          snapshotClone === null ||
          typeof snapshotClone !== 'object' ||
          apply(elementOuterHtml, snapshotControl, []) !== expectedSnapshot ||
          apply(elementOuterHtml, nestedControl, []) !== expectedNested ||
          apply(elementOuterHtml, snapshotClone, []) !== expectedSnapshot
        ) {
          return false;
        }
        const nestedClone = apply<unknown>(elementQuerySelector, snapshotClone, [
          '[kovo-nav-segment="nested-control"]',
        ]);
        if (nestedClone === null || typeof nestedClone !== 'object') return false;
        apply(elementRemove, nestedClone, []);
        if (apply(elementOuterHtml, snapshotClone, []) !== expectedWithoutNested) return false;

        apply(elementAppend, snapshotControl, [appendControl]);
        apply(elementPrepend, snapshotControl, [prependControl]);
        if (
          apply(elementOuterHtml, snapshotControl, []) !==
          '<section kovo-nav-segment="security-control"><b data-kovo-commit="prepend"></b><span kovo-nav-segment="nested-control" kovo-fragment-target="security-live-target"></span><i data-kovo-commit="append"></i></section>'
        ) {
          return false;
        }
        apply(elementReplaceChildren, snapshotControl, [nestedControl]);
        if (apply(elementOuterHtml, snapshotControl, []) !== expectedSnapshot) return false;
        apply(elementReplaceWith, nestedControl, [replacementControl]);
        if (
          apply(elementOuterHtml, snapshotControl, []) !==
          '<section kovo-nav-segment="security-control"><article kovo-fragment-target="security-live-target"></article></section>'
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
    appendElementChildren,
    call,
    charCode,
    cloneDomNode,
    cloneElement,
    createFragmentContent,
    createTextDecoder,
    currentPathTarget,
    currentUrl,
    decodeComponent,
    decodeText,
    fetchDocument,
    fetchValue,
    hardNavigate,
    hasElementAttribute,
    elementContains,
    isHtmlContentType,
    isTrimmedAsciiEqual,
    indexOf,
    lower,
    navigateSameOrigin,
    parseHtmlDocument,
    parseUrl,
    prependElementChildren,
    queryOne,
    queryAllElements,
    readAttribute,
    readDocumentActiveElement,
    readElementOuterHtml,
    readElementTagName,
    readHeader,
    readFormDataValue,
    readDocumentField,
    readResponseField,
    readResponseText,
    regExpExec,
    regExpTest,
    readNodeIsConnected,
    removeElementAttribute,
    reload,
    removeElement,
    replaceElement,
    replaceElementChildren,
    safeSameOriginPath,
    setElementAttribute,
    slice,
    snapshotChildNodes,
    snapshotElementAttributes,
    snapshotElementChildren,
    trim,
    upper,
  };
}
