export interface NavigationUrlFacts {
  hash: string;
  href: string;
  origin: string;
  pathname: string;
  search: string;
}

/** @internal Boot-witnessed readable-stream/reader binding for mutation bytes. */
export type BrowserStreamReaderPlan = readonly [
  stream: ReadableStream<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  witness: object,
];

/** @internal Dense copied byte result returned by the browser stream membrane. */
export type BrowserStreamChunkSnapshot =
  | { done: true; value?: undefined }
  | { done: false; value: Uint8Array };

/** @internal Deeply immutable, own-data mutation broadcast change. */
export interface BrowserMutationBroadcastChangeSnapshot {
  readonly domain: string;
  readonly keys?: readonly string[];
}

/** @internal Exact mutation broadcast envelope accepted from MessageEvent.data. */
export interface BrowserMutationBroadcastEnvelopeSnapshot {
  readonly body: string;
  readonly buildToken?: string;
  readonly changes: readonly BrowserMutationBroadcastChangeSnapshot[];
  readonly principal?: string;
  readonly type: 'kovo:mutation-response';
}

/** @internal Immutable platform-event facts used for delegated authority selection. */
export interface BrowserDelegatedEventSnapshot {
  readonly altKey: boolean;
  readonly button: number;
  readonly cancelable: boolean;
  readonly ctrlKey: boolean;
  readonly defaultPrevented: boolean;
  readonly metaKey: boolean;
  readonly relatedTarget: object | null;
  readonly shiftKey: boolean;
  readonly submitter: unknown;
  readonly target: object | null;
  readonly type: string;
}

/** @internal Private exact response facts bound to one accepted fetch carrier. */
interface BrowserFetchResponsePlan {
  readonly body: unknown;
  readonly headers: readonly (readonly [string, string | undefined])[];
  readonly ok: unknown;
  readonly redirected: unknown;
  readonly status: unknown;
  readonly textMethod?: Function;
  readonly textReceiver: object;
  readonly url: unknown;
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
export function createBrowserNavigationSecurityControls(
  scope: typeof globalThis = globalThis,
  createHTML?: (html: string) => unknown,
) {
  const NativeObject = Object;
  const NativeArray = Array;
  const NativeMap = Map;
  const NativePromise = Promise;
  const NativeWeakMap = WeakMap;
  const NativeReflect = Reflect;
  const NativeRegExp = RegExp;
  const NativeString = String;
  const NativeURL = scope.URL;
  const NativeHeaders = scope.Headers;
  const NativeResponse = scope.Response;
  const NativeDOMParser = scope.DOMParser;
  const NativeFormData = scope.FormData;
  const NativeDocument = scope.Document;
  const NativeElement = scope.Element;
  const NativeNode = scope.Node;
  const NativeDocumentFragment = scope.DocumentFragment;
  const NativeHTMLTemplateElement = scope.HTMLTemplateElement;
  const NativeHTMLFormElement = scope.HTMLFormElement;
  const NativeHTMLDetailsElement = scope.HTMLDetailsElement;
  const NativeHTMLDialogElement = scope.HTMLDialogElement;
  const NativeHTMLButtonElement = scope.HTMLButtonElement;
  const NativeHTMLInputElement = scope.HTMLInputElement;
  const NativeHTMLMeterElement = scope.HTMLMeterElement;
  const NativeHTMLOptionElement = scope.HTMLOptionElement;
  const NativeHTMLOutputElement = scope.HTMLOutputElement;
  const NativeHTMLProgressElement = scope.HTMLProgressElement;
  const NativeHTMLSelectElement = scope.HTMLSelectElement;
  const NativeHTMLTextAreaElement = scope.HTMLTextAreaElement;
  const NativeHTMLCollection = scope.HTMLCollection;
  const NativeNodeList = scope.NodeList;
  const NativeNamedNodeMap = scope.NamedNodeMap;
  const NativeAttr = scope.Attr;
  const NativeTextDecoder = scope.TextDecoder;
  const NativeUint8Array = scope.Uint8Array;
  const NativeReadableStream = scope.ReadableStream;
  const NativeReadableStreamDefaultReader = scope.ReadableStreamDefaultReader;
  const NativeEvent = scope.Event;
  const NativeCustomEvent = scope.CustomEvent;
  const NativeEventTarget = scope.EventTarget;
  const NativeMouseEvent = scope.MouseEvent;
  const NativeSubmitEvent = scope.SubmitEvent;
  const NativePageTransitionEvent = scope.PageTransitionEvent;
  const NativeMessageEvent = scope.MessageEvent;
  const NativeBroadcastChannel = scope.BroadcastChannel;
  const NativeAbortController = scope.AbortController;
  const NativeAbortSignal = scope.AbortSignal;
  const cryptoObject = scope.crypto;
  const nativeDecodeURIComponent = scope.decodeURIComponent;
  const nativeReflectApply = NativeReflect.apply;
  const nativeObjectDefineProperty = NativeObject.defineProperty;
  const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeObjectFreeze = NativeObject.freeze;
  const nativeObjectIsFrozen = NativeObject.isFrozen;
  const nativeArrayIsArray = NativeArray.isArray;
  const nativeMapGet = valueMethod(NativeMap.prototype, 'get');
  const nativeMapHas = valueMethod(NativeMap.prototype, 'has');
  const nativeMapSet = valueMethod(NativeMap.prototype, 'set');
  const nativePromiseThen = NativePromise.prototype.then;
  const nativeWeakMapGet = valueMethod(NativeWeakMap.prototype, 'get');
  const nativeWeakMapHas = valueMethod(NativeWeakMap.prototype, 'has');
  const nativeWeakMapSet = valueMethod(NativeWeakMap.prototype, 'set');
  const nativeRegExpExec = NativeRegExp.prototype.exec;
  const nativeRegExpTest = NativeRegExp.prototype.test;
  const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
  const nativeStringIndexOf = NativeString.prototype.indexOf;
  const nativeStringSlice = NativeString.prototype.slice;
  const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
  const nativeStringToUpperCase = NativeString.prototype.toUpperCase;
  const nativeStringTrim = NativeString.prototype.trim;
  const urlPrototype = NativeURL?.prototype;
  const urlHref = urlPrototype ? getter(urlPrototype, 'href') : undefined;
  const urlOrigin = urlPrototype ? getter(urlPrototype, 'origin') : undefined;
  const urlPathname = urlPrototype ? getter(urlPrototype, 'pathname') : undefined;
  const urlSearch = urlPrototype ? getter(urlPrototype, 'search') : undefined;
  const urlHash = urlPrototype ? getter(urlPrototype, 'hash') : undefined;
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
  const formDataSet = NativeFormData ? valueMethod(NativeFormData.prototype, 'set') : undefined;
  const documentQuerySelector = NativeDocument
    ? valueMethod(NativeDocument.prototype, 'querySelector')
    : undefined;
  const documentQuerySelectorAll = NativeDocument
    ? valueMethod(NativeDocument.prototype, 'querySelectorAll')
    : undefined;
  const documentGetElementById = NativeDocument
    ? valueMethod(NativeDocument.prototype, 'getElementById')
    : undefined;
  const elementQuerySelector = NativeElement
    ? valueMethod(NativeElement.prototype, 'querySelector')
    : undefined;
  const fragmentQuerySelector = NativeDocumentFragment
    ? valueMethod(NativeDocumentFragment.prototype, 'querySelector')
    : undefined;
  const fragmentQuerySelectorAll = NativeDocumentFragment
    ? valueMethod(NativeDocumentFragment.prototype, 'querySelectorAll')
    : undefined;
  const elementQuerySelectorAll = NativeElement
    ? valueMethod(NativeElement.prototype, 'querySelectorAll')
    : undefined;
  const elementGetAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'getAttribute')
    : undefined;
  const elementClosest = NativeElement
    ? valueMethod(NativeElement.prototype, 'closest')
    : undefined;
  const elementHasAttribute = NativeElement
    ? valueMethod(NativeElement.prototype, 'hasAttribute')
    : undefined;
  const elementMatches = NativeElement
    ? valueMethod(NativeElement.prototype, 'matches')
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
  const nodeInsertBefore = NativeNode
    ? valueMethod(NativeNode.prototype, 'insertBefore')
    : undefined;
  const nodeChildNodes = NativeNode ? getter(NativeNode.prototype, 'childNodes') : undefined;
  const nodeContains = NativeNode ? valueMethod(NativeNode.prototype, 'contains') : undefined;
  const nodeIsConnected = NativeNode ? getter(NativeNode.prototype, 'isConnected') : undefined;
  const nodeTextContent = NativeNode ? getter(NativeNode.prototype, 'textContent') : undefined;
  const nodeTextContentSetter = NativeNode
    ? setter(NativeNode.prototype, 'textContent')
    : undefined;
  const abortControllerAbort = NativeAbortController
    ? valueMethod(NativeAbortController.prototype, 'abort')
    : undefined;
  const abortControllerSignal = NativeAbortController
    ? getter(NativeAbortController.prototype, 'signal')
    : undefined;
  const abortSignalAborted = NativeAbortSignal
    ? getter(NativeAbortSignal.prototype, 'aborted')
    : undefined;
  const elementScrollLeft = NativeElement
    ? stableGetter(NativeElement.prototype, 'scrollLeft')
    : undefined;
  const elementScrollLeftSetter = NativeElement
    ? stableSetter(NativeElement.prototype, 'scrollLeft')
    : undefined;
  const elementScrollTop = NativeElement
    ? stableGetter(NativeElement.prototype, 'scrollTop')
    : undefined;
  const elementScrollTopSetter = NativeElement
    ? stableSetter(NativeElement.prototype, 'scrollTop')
    : undefined;
  const inputChecked = NativeHTMLInputElement
    ? stableGetter(NativeHTMLInputElement.prototype, 'checked')
    : undefined;
  const inputCheckedSetter = NativeHTMLInputElement
    ? stableSetter(NativeHTMLInputElement.prototype, 'checked')
    : undefined;
  const inputIndeterminate = NativeHTMLInputElement
    ? stableGetter(NativeHTMLInputElement.prototype, 'indeterminate')
    : undefined;
  const inputIndeterminateSetter = NativeHTMLInputElement
    ? stableSetter(NativeHTMLInputElement.prototype, 'indeterminate')
    : undefined;
  const inputValue = NativeHTMLInputElement
    ? stableGetter(NativeHTMLInputElement.prototype, 'value')
    : undefined;
  const inputValueSetter = NativeHTMLInputElement
    ? stableSetter(NativeHTMLInputElement.prototype, 'value')
    : undefined;
  const optionSelected = NativeHTMLOptionElement
    ? stableGetter(NativeHTMLOptionElement.prototype, 'selected')
    : undefined;
  const optionSelectedSetter = NativeHTMLOptionElement
    ? stableSetter(NativeHTMLOptionElement.prototype, 'selected')
    : undefined;
  const detailsOpen = NativeHTMLDetailsElement
    ? stableGetter(NativeHTMLDetailsElement.prototype, 'open')
    : undefined;
  const detailsOpenSetter = NativeHTMLDetailsElement
    ? stableSetter(NativeHTMLDetailsElement.prototype, 'open')
    : undefined;
  const dialogOpen = NativeHTMLDialogElement
    ? stableGetter(NativeHTMLDialogElement.prototype, 'open')
    : undefined;
  const dialogOpenSetter = NativeHTMLDialogElement
    ? stableSetter(NativeHTMLDialogElement.prototype, 'open')
    : undefined;
  const progressValue = NativeHTMLProgressElement
    ? stableGetter(NativeHTMLProgressElement.prototype, 'value')
    : undefined;
  const progressValueSetter = NativeHTMLProgressElement
    ? stableSetter(NativeHTMLProgressElement.prototype, 'value')
    : undefined;
  const selectValue = NativeHTMLSelectElement
    ? stableGetter(NativeHTMLSelectElement.prototype, 'value')
    : undefined;
  const selectValueSetter = NativeHTMLSelectElement
    ? stableSetter(NativeHTMLSelectElement.prototype, 'value')
    : undefined;
  const textAreaValue = NativeHTMLTextAreaElement
    ? stableGetter(NativeHTMLTextAreaElement.prototype, 'value')
    : undefined;
  const textAreaValueSetter = NativeHTMLTextAreaElement
    ? stableSetter(NativeHTMLTextAreaElement.prototype, 'value')
    : undefined;
  const buttonValue = NativeHTMLButtonElement
    ? stableGetter(NativeHTMLButtonElement.prototype, 'value')
    : undefined;
  const buttonValueSetter = NativeHTMLButtonElement
    ? stableSetter(NativeHTMLButtonElement.prototype, 'value')
    : undefined;
  const meterValue = NativeHTMLMeterElement
    ? stableGetter(NativeHTMLMeterElement.prototype, 'value')
    : undefined;
  const meterValueSetter = NativeHTMLMeterElement
    ? stableSetter(NativeHTMLMeterElement.prototype, 'value')
    : undefined;
  const optionValue = NativeHTMLOptionElement
    ? stableGetter(NativeHTMLOptionElement.prototype, 'value')
    : undefined;
  const optionValueSetter = NativeHTMLOptionElement
    ? stableSetter(NativeHTMLOptionElement.prototype, 'value')
    : undefined;
  const outputValue = NativeHTMLOutputElement
    ? stableGetter(NativeHTMLOutputElement.prototype, 'value')
    : undefined;
  const outputValueSetter = NativeHTMLOutputElement
    ? stableSetter(NativeHTMLOutputElement.prototype, 'value')
    : undefined;
  const fragmentChildren = NativeDocumentFragment
    ? getter(NativeDocumentFragment.prototype, 'children')
    : undefined;
  const templateContent = NativeHTMLTemplateElement
    ? getter(NativeHTMLTemplateElement.prototype, 'content')
    : undefined;
  const htmlFormSubmit = NativeHTMLFormElement
    ? valueMethod(NativeHTMLFormElement.prototype, 'submit')
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
  const uint8ArrayByteLength = NativeUint8Array
    ? stableGetter(NativeUint8Array.prototype, 'byteLength')
    : undefined;
  const uint8ArraySet = NativeUint8Array
    ? stableMethod(NativeUint8Array.prototype, 'set')
    : undefined;
  const readableStreamCancel = NativeReadableStream
    ? valueMethod(NativeReadableStream.prototype, 'cancel')
    : undefined;
  const readableStreamGetReader = NativeReadableStream
    ? valueMethod(NativeReadableStream.prototype, 'getReader')
    : undefined;
  const readableStreamLocked = NativeReadableStream
    ? getter(NativeReadableStream.prototype, 'locked')
    : undefined;
  const readerCancel = NativeReadableStreamDefaultReader
    ? valueMethod(NativeReadableStreamDefaultReader.prototype, 'cancel')
    : undefined;
  const readerRead = NativeReadableStreamDefaultReader
    ? valueMethod(NativeReadableStreamDefaultReader.prototype, 'read')
    : undefined;
  const readerReleaseLock = NativeReadableStreamDefaultReader
    ? valueMethod(NativeReadableStreamDefaultReader.prototype, 'releaseLock')
    : undefined;
  const eventTargetAddEventListener = NativeEventTarget
    ? valueMethod(NativeEventTarget.prototype, 'addEventListener')
    : undefined;
  const eventTargetRemoveEventListener = NativeEventTarget
    ? valueMethod(NativeEventTarget.prototype, 'removeEventListener')
    : undefined;
  const eventTargetDispatchEvent = NativeEventTarget
    ? valueMethod(NativeEventTarget.prototype, 'dispatchEvent')
    : undefined;
  const eventTypeGetter = NativeEvent ? getter(NativeEvent.prototype, 'type') : undefined;
  const eventTargetGetter = NativeEvent ? getter(NativeEvent.prototype, 'target') : undefined;
  const eventCancelableGetter = NativeEvent
    ? getter(NativeEvent.prototype, 'cancelable')
    : undefined;
  const eventDefaultPreventedGetter = NativeEvent
    ? getter(NativeEvent.prototype, 'defaultPrevented')
    : undefined;
  const eventPreventDefault = NativeEvent
    ? valueMethod(NativeEvent.prototype, 'preventDefault')
    : undefined;
  const customEventDetail = NativeCustomEvent
    ? getter(NativeCustomEvent.prototype, 'detail')
    : undefined;
  const mouseEventRelatedTarget = NativeMouseEvent
    ? getter(NativeMouseEvent.prototype, 'relatedTarget')
    : undefined;
  const mouseEventButton = NativeMouseEvent
    ? getter(NativeMouseEvent.prototype, 'button')
    : undefined;
  const mouseEventAltKey = NativeMouseEvent
    ? getter(NativeMouseEvent.prototype, 'altKey')
    : undefined;
  const mouseEventCtrlKey = NativeMouseEvent
    ? getter(NativeMouseEvent.prototype, 'ctrlKey')
    : undefined;
  const mouseEventMetaKey = NativeMouseEvent
    ? getter(NativeMouseEvent.prototype, 'metaKey')
    : undefined;
  const mouseEventShiftKey = NativeMouseEvent
    ? getter(NativeMouseEvent.prototype, 'shiftKey')
    : undefined;
  const submitEventSubmitter = NativeSubmitEvent
    ? getter(NativeSubmitEvent.prototype, 'submitter')
    : undefined;
  const pageTransitionPersisted = NativePageTransitionEvent
    ? getter(NativePageTransitionEvent.prototype, 'persisted')
    : undefined;
  const messageEventData = NativeMessageEvent
    ? getter(NativeMessageEvent.prototype, 'data')
    : undefined;
  const broadcastChannelPrototype = NativeBroadcastChannel?.prototype;
  const broadcastChannelName = broadcastChannelPrototype
    ? stableGetter(broadcastChannelPrototype, 'name')
    : undefined;
  const broadcastChannelPostMessage = broadcastChannelPrototype
    ? stableMethod(broadcastChannelPrototype, 'postMessage')
    : undefined;
  const broadcastChannelClose = broadcastChannelPrototype
    ? stableMethod(broadcastChannelPrototype, 'close')
    : undefined;
  const broadcastChannelOnMessageSetter = broadcastChannelPrototype
    ? stableSetter(broadcastChannelPrototype, 'onmessage')
    : undefined;
  const broadcastChannelOnMessage = broadcastChannelPrototype
    ? stableGetter(broadcastChannelPrototype, 'onmessage')
    : undefined;
  const cryptoRandomUuid = cryptoObject ? stableMethod(cryptoObject, 'randomUUID') : undefined;
  // C230 / SPEC §6.6/§9.1: Window.fetch is an own data method in the supported engines. Capture
  // the exact boot value; never reread the mutable global after authored modules can run.
  const browserFetch = valueMethod(scope, 'fetch');
  const nativeSetTimeout = stableMethod(scope, 'setTimeout');
  const nativeClearTimeout = stableMethod(scope, 'clearTimeout');
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
  const fetchResponsePlans = new NativeWeakMap<object, BrowserFetchResponsePlan>();
  const islandAbortControllers = new NativeWeakMap<object, AbortController>();
  const fetchHeaderNames = [
    ['content-type', 'content-type'],
    ['kovo-build', 'Kovo-Build'],
    ['kovo-changes', 'Kovo-Changes'],
    ['kovo-session-transition', 'Kovo-Session-Transition'],
    ['kovo-reauth', 'Kovo-Reauth'],
    ['location', 'Location'],
  ] as const;
  const streamReaderPlanWitness = {};
  let responseControlsReady: Promise<void> | undefined;
  let responseControlsVerified = false;
  let streamControlsReady: Promise<void> | undefined;
  let streamControlsVerified = false;
  let broadcastControlsReady: Promise<void> | undefined;
  let broadcastControlsVerified = false;
  let broadcastWitnessPrincipal: string | undefined;

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
  ): ((value: unknown) => void) | undefined {
    let owner: object | null = value;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      const found = descriptor(owner, property);
      if (found?.set) return found.set;
      if (found !== undefined) return undefined;
      owner = prototypeOf(owner);
    }
    return undefined;
  }

  function readOwnData(value: object, property: PropertyKey): unknown {
    const found = descriptor(value, property);
    return found && 'value' in found ? found.value : undefined;
  }

  function getOwnSecurityPropertyDescriptor(
    value: object,
    property: PropertyKey,
  ): PropertyDescriptor | undefined {
    if (!controlsSound) throw new TypeError('Kovo browser navigation controls are unavailable.');
    return descriptor(value, property);
  }

  function createSecurityMap<Key, Value>(): Map<Key, Value> {
    if (!controlsSound || !nativeMapGet || !nativeMapHas || !nativeMapSet) {
      throw new TypeError('Kovo browser Map controls are unavailable.');
    }
    return new NativeMap<Key, Value>();
  }

  function getSecurityMapValue<Key, Value>(
    map: ReadonlyMap<Key, Value>,
    key: Key,
  ): Value | undefined {
    if (!controlsSound || !nativeMapGet) {
      throw new TypeError('Kovo browser Map controls are unavailable.');
    }
    return apply<Value | undefined>(nativeMapGet, map, [key]);
  }

  function hasSecurityMapValue<Key>(map: ReadonlyMap<Key, unknown>, key: Key): boolean {
    if (!controlsSound || !nativeMapHas) {
      throw new TypeError('Kovo browser Map controls are unavailable.');
    }
    return apply<boolean>(nativeMapHas, map, [key]) === true;
  }

  function setSecurityMapValue<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
    if (!controlsSound || !nativeMapGet || !nativeMapHas || !nativeMapSet) {
      throw new TypeError('Kovo browser Map controls are unavailable.');
    }
    if (
      apply<unknown>(nativeMapSet, map, [key, value]) !== map ||
      apply<boolean>(nativeMapHas, map, [key]) !== true ||
      apply<Value | undefined>(nativeMapGet, map, [key]) !== value
    ) {
      throw new TypeError('Kovo browser Map write control rejected its commit.');
    }
  }

  function fetchResponsePlan(response: object): BrowserFetchResponsePlan | undefined {
    if (!nativeWeakMapGet) return undefined;
    return apply<BrowserFetchResponsePlan | undefined>(nativeWeakMapGet, fetchResponsePlans, [
      response,
    ]);
  }

  function rememberFetchResponsePlan(response: object, plan: BrowserFetchResponsePlan): void {
    if (!nativeWeakMapSet) {
      throw new TypeError('Kovo navigation response carrier control is unavailable.');
    }
    apply(nativeWeakMapSet, fetchResponsePlans, [response, plan]);
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

  function getElementById(root: unknown, id: string): Element | undefined {
    if (!controlsSound || root === null || typeof root !== 'object') return undefined;
    const custom = stableMethod(root, 'getElementById');
    const methods = [documentGetElementById, custom];
    for (let index = 0; index < methods.length; index += 1) {
      const method = methods[index];
      if (!method || (index > 0 && method === methods[0])) continue;
      try {
        const value = call<unknown>(method, root, [id]);
        if (value !== null && typeof value === 'object') return value as Element;
        if (value === null) return undefined;
      } catch {}
    }
    return undefined;
  }

  function callEventTargetMethod(
    target: unknown,
    platformMethod: Function | undefined,
    property: 'addEventListener' | 'dispatchEvent' | 'removeEventListener',
    args: readonly unknown[],
  ): boolean {
    if (!controlsSound || (typeof target !== 'object' && typeof target !== 'function') || !target) {
      return false;
    }
    if (platformMethod) {
      try {
        apply(platformMethod, target, args);
        return true;
      } catch {}
    }
    // Keep the explicit structural seam used by non-browser conformance tests. A real browser
    // Window/Document is accepted by the captured EventTarget method above, so a late poisoned
    // prototype is never consulted for the security-bearing lifecycle enrollment.
    const custom = stableMethod(target, property);
    if (!custom) return false;
    try {
      apply(custom, target, args);
      return true;
    } catch {
      return false;
    }
  }

  function addLifecycleEventListener(
    target: unknown,
    type: string,
    listener: (event: unknown) => void,
    options?: unknown,
  ): boolean {
    return callEventTargetMethod(
      target,
      eventTargetAddEventListener,
      'addEventListener',
      options === undefined ? [type, listener] : [type, listener, options],
    );
  }

  function removeLifecycleEventListener(
    target: unknown,
    type: string,
    listener: (event: unknown) => void,
    options?: unknown,
  ): boolean {
    return callEventTargetMethod(
      target,
      eventTargetRemoveEventListener,
      'removeEventListener',
      options === undefined ? [type, listener] : [type, listener, options],
    );
  }

  function dispatchCustomEvent(target: unknown, type: string, detail: unknown): boolean {
    if (!controlsSound || !NativeCustomEvent || typeof type !== 'string' || type.length === 0) {
      return false;
    }
    let event: CustomEvent;
    try {
      event = new NativeCustomEvent(type, { detail });
      if (readEventField(event, customEventDetail, 'detail') !== detail) return false;
    } catch {
      return false;
    }
    return callEventTargetMethod(target, eventTargetDispatchEvent, 'dispatchEvent', [event]);
  }

  function readAttribute(element: unknown, name: string): string | null {
    if (!controlsSound || element === null || typeof element !== 'object') return null;
    const value = callPlatformOrCustom<unknown>(element, [elementGetAttribute], 'getAttribute', [
      name,
    ]);
    return typeof value === 'string' ? value : null;
  }

  function closestElement(element: unknown, selector: string): Element | null {
    if (!controlsSound || element === null || typeof element !== 'object') return null;
    const value = callPlatformOrCustom<unknown>(element, [elementClosest], 'closest', [selector]);
    return value !== null && typeof value === 'object' ? (value as Element) : null;
  }

  function readEventField(
    event: object,
    fieldGetter: (() => unknown) | undefined,
    property: PropertyKey,
  ): unknown {
    if (fieldGetter) {
      try {
        return apply(fieldGetter, event, []);
      } catch {}
    }
    return readOwnData(event, property);
  }

  function snapshotDelegatedEvent(event: unknown): BrowserDelegatedEventSnapshot | undefined {
    if (!controlsSound || event === null || typeof event !== 'object') return undefined;
    const type = readEventField(event, eventTypeGetter, 'type');
    const target = readEventField(event, eventTargetGetter, 'target');
    if (
      typeof type !== 'string' ||
      type.length === 0 ||
      (target !== null && typeof target !== 'object')
    ) {
      return undefined;
    }
    const relatedTarget = readEventField(event, mouseEventRelatedTarget, 'relatedTarget');
    const button = readEventField(event, mouseEventButton, 'button');
    return freezeBrowserSnapshot({
      altKey: readEventField(event, mouseEventAltKey, 'altKey') === true,
      button: typeof button === 'number' ? button : 0,
      cancelable: readEventField(event, eventCancelableGetter, 'cancelable') === true,
      ctrlKey: readEventField(event, mouseEventCtrlKey, 'ctrlKey') === true,
      defaultPrevented:
        readEventField(event, eventDefaultPreventedGetter, 'defaultPrevented') === true,
      metaKey: readEventField(event, mouseEventMetaKey, 'metaKey') === true,
      relatedTarget:
        relatedTarget !== null && typeof relatedTarget === 'object' ? relatedTarget : null,
      shiftKey: readEventField(event, mouseEventShiftKey, 'shiftKey') === true,
      submitter: readEventField(event, submitEventSubmitter, 'submitter'),
      target,
      type,
    });
  }

  function readCustomEventDetail(event: unknown): unknown {
    if (!controlsSound || event === null || typeof event !== 'object') return undefined;
    return readEventField(event, customEventDetail, 'detail');
  }

  function preventDelegatedEventDefault(event: unknown): boolean {
    if (!controlsSound || event === null || typeof event !== 'object') return false;
    if (eventPreventDefault) {
      try {
        apply(eventPreventDefault, event, []);
        return true;
      } catch {}
    }
    const custom = readOwnData(event, 'preventDefault');
    if (typeof custom !== 'function') return false;
    try {
      apply(custom, event, []);
      return true;
    } catch {
      return false;
    }
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

  function appendDenseSecurityValue<T>(values: T[], value: T, label: string): void {
    const lengthDescriptor = descriptor(values, 'length');
    const length =
      lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (typeof length !== 'number' || length < 0 || length >= 100_000 || length % 1 !== 0) {
      throw new TypeError(label + ' length is invalid.');
    }
    apply(nativeObjectDefineProperty, NativeObject, [
      values,
      length,
      {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      },
    ]);
    const committed = descriptor(values, length);
    const nextLength = descriptor(values, 'length');
    if (
      !committed ||
      !('value' in committed) ||
      committed.value !== value ||
      !nextLength ||
      !('value' in nextLength) ||
      nextLength.value !== length + 1
    ) {
      throw new TypeError(label + ' own-data commit failed.');
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
      if (!read) entry = readOwnData(collection, apply<string>(NativeString, undefined, [index]));
      if (entry === null || entry === undefined) {
        throw new TypeError('Kovo DOM collection item is unavailable.');
      }
      appendDenseSecurityValue(snapshot, entry as T, 'Kovo DOM collection snapshot');
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
      appendDenseSecurityValue(snapshot, { name, value }, 'Kovo DOM attribute snapshot');
    }
    return snapshot;
  }

  function queryAllElements(root: object, selector: string): Element[] {
    let collection: unknown;
    const platformMethods = [
      documentQuerySelectorAll,
      elementQuerySelectorAll,
      fragmentQuerySelectorAll,
    ];
    for (let index = 0; index < platformMethods.length; index += 1) {
      const method = platformMethods[index];
      if (!method) continue;
      try {
        collection = apply(method, root, [selector]);
        break;
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

  function isPlatformElement(value: unknown): value is Element {
    if (!controlsSound || !elementTagName || value === null || typeof value !== 'object') {
      return false;
    }
    try {
      return typeof apply<unknown>(elementTagName, value, []) === 'string';
    } catch {
      return false;
    }
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

  function setNodeTextContent(node: object, value: string): void {
    if (nodeTextContentSetter) {
      try {
        call(nodeTextContentSetter, node, [value]);
        return;
      } catch {}
    }
    const own = descriptor(node, 'textContent');
    if (own && 'value' in own && own.writable === true) {
      apply(nativeObjectDefineProperty, NativeObject, [node, 'textContent', { ...own, value }]);
      return;
    }
    const custom = stableSetter(node, 'textContent');
    if (!custom) throw new TypeError('Kovo DOM text-content control is unavailable.');
    call(custom, node, [value]);
  }

  function readNodeTextContent(node: object): string | null {
    const value = readDomProperty(node, 'textContent', [nodeTextContent]);
    return typeof value === 'string' ? value : null;
  }

  function elementPropertyControls(property: string):
    | {
        getters: readonly (((...args: never[]) => unknown) | undefined)[];
        setters: readonly (Function | undefined)[];
      }
    | undefined {
    if (property === 'checked') {
      return { getters: [inputChecked], setters: [inputCheckedSetter] };
    }
    if (property === 'indeterminate') {
      return { getters: [inputIndeterminate], setters: [inputIndeterminateSetter] };
    }
    if (property === 'selected') {
      return { getters: [optionSelected], setters: [optionSelectedSetter] };
    }
    if (property === 'open') {
      return {
        getters: [dialogOpen, detailsOpen],
        setters: [dialogOpenSetter, detailsOpenSetter],
      };
    }
    if (property === 'scrollLeft') {
      return { getters: [elementScrollLeft], setters: [elementScrollLeftSetter] };
    }
    if (property === 'scrollTop') {
      return { getters: [elementScrollTop], setters: [elementScrollTopSetter] };
    }
    if (property === 'value') {
      return {
        getters: [
          inputValue,
          textAreaValue,
          selectValue,
          progressValue,
          buttonValue,
          optionValue,
          outputValue,
          meterValue,
        ],
        setters: [
          inputValueSetter,
          textAreaValueSetter,
          selectValueSetter,
          progressValueSetter,
          buttonValueSetter,
          optionValueSetter,
          outputValueSetter,
          meterValueSetter,
        ],
      };
    }
    return undefined;
  }

  function readElementProperty(element: object, property: string): unknown {
    const controls = elementPropertyControls(property);
    if (!controls) return undefined;
    return readDomProperty(element, property, controls.getters);
  }

  function setElementProperty(element: object, property: string, value: unknown): void {
    const controls = elementPropertyControls(property);
    if (!controls) throw new TypeError('Kovo DOM property control is unavailable.');
    for (let index = 0; index < controls.setters.length; index += 1) {
      const write = controls.setters[index];
      if (!write) continue;
      try {
        call(write, element, [value]);
        return;
      } catch {}
    }
    const own = descriptor(element, property);
    if (own && 'value' in own && own.writable === true) {
      apply(nativeObjectDefineProperty, NativeObject, [element, property, { ...own, value }]);
      return;
    }
    throw new TypeError('Kovo DOM property control rejected its receiver.');
  }

  function submitForm(form: unknown): boolean {
    if (!controlsSound || form === null || typeof form !== 'object') return false;
    if (htmlFormSubmit) {
      try {
        apply(htmlFormSubmit, form, []);
        return true;
      } catch {}
    }

    // Explicit structural seam for browser-free conformance fakes. Never walk a caller-controlled
    // prototype after boot: a real HTMLFormElement must use the captured platform method above.
    const submit = readOwnData(form, 'submit');
    if (typeof submit !== 'function') return false;
    try {
      apply(submit, form, []);
      return true;
    } catch {
      return false;
    }
  }

  function elementContains(element: object, node: object | null): boolean {
    const method = nodeContains ?? stableMethod(element, 'contains');
    if (!method) throw new TypeError('Kovo DOM contains control is unavailable.');
    return call<unknown>(method, element, [node]) === true;
  }

  function matchesElement(element: object, selector: string): boolean {
    if (elementMatches) {
      try {
        return call<unknown>(elementMatches, element, [selector]) === true;
      } catch {}
    }
    const custom = stableMethod(element, 'matches');
    if (!custom) return false;
    try {
      return call<unknown>(custom, element, [selector]) === true;
    } catch {
      return false;
    }
  }

  function readControllerSignal(controller: AbortController): AbortSignal {
    if (!abortControllerSignal || !abortSignalAborted) {
      throw new TypeError('Kovo island AbortController controls are unavailable.');
    }
    const signal = call<unknown>(abortControllerSignal, controller, []);
    if (signal === null || typeof signal !== 'object') {
      throw new TypeError('Kovo island AbortController signal is unavailable.');
    }
    const aborted = call<unknown>(abortSignalAborted, signal, []);
    if (typeof aborted !== 'boolean') {
      throw new TypeError('Kovo island AbortSignal state is unavailable.');
    }
    return signal as AbortSignal;
  }

  function islandAbortSignal(island: object): AbortSignal {
    if (!controlsSound || !NativeAbortController || !nativeWeakMapGet || !nativeWeakMapSet) {
      throw new TypeError('Kovo island AbortController controls are unavailable.');
    }
    let controller = apply<AbortController | undefined>(nativeWeakMapGet, islandAbortControllers, [
      island,
    ]);
    if (controller === undefined) {
      controller = new NativeAbortController();
      if (
        apply<unknown>(nativeWeakMapSet, islandAbortControllers, [island, controller]) !==
        islandAbortControllers
      ) {
        throw new TypeError('Kovo island AbortController registry rejected its write.');
      }
    }
    return readControllerSignal(controller);
  }

  function retireIslandSignal(island: object): boolean {
    if (!controlsSound || !abortControllerAbort || !abortSignalAborted || !nativeWeakMapGet) {
      throw new TypeError('Kovo island AbortController controls are unavailable.');
    }
    const controller = apply<AbortController | undefined>(
      nativeWeakMapGet,
      islandAbortControllers,
      [island],
    );
    if (controller === undefined) return false;
    const signal = readControllerSignal(controller);
    if (call<unknown>(abortSignalAborted, signal, []) !== true) {
      call(abortControllerAbort, controller, []);
    }
    if (call<unknown>(abortSignalAborted, signal, []) !== true) {
      throw new TypeError('Kovo island AbortController failed to retire its signal.');
    }
    return true;
  }

  function createHtmlElement(localName: string): Element {
    if (
      !controlsSound ||
      !documentObject ||
      !documentCreateElement ||
      !regExpTest(/^[a-z][a-z0-9-]*$/, localName)
    ) {
      throw new TypeError('Kovo DOM element creation control is unavailable.');
    }
    const element = apply<unknown>(documentCreateElement, documentObject, [localName]);
    if (
      element === null ||
      typeof element !== 'object' ||
      readElementTagName(element) !== upper(localName)
    ) {
      throw new TypeError('Kovo DOM element creation returned a mismatched element.');
    }
    return element as Element;
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

  function insertDomNode(parent: Node, node: Node, anchor: Node | null): void {
    const method = nodeInsertBefore ?? stableMethod(parent, 'insertBefore');
    if (!method || call<unknown>(method, parent, [node, anchor]) !== node) {
      throw new TypeError('Kovo DOM insertion control rejected its commit.');
    }
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

  function observePromiseRejection(promise: Promise<unknown>): void {
    try {
      apply(nativePromiseThen, promise, [undefined, () => undefined]);
    } catch {
      throw new TypeError('Kovo browser control returned a non-native promise.');
    }
  }

  async function awaitNativePromise<Value>(value: unknown): Promise<Value> {
    if (value === null || typeof value !== 'object') {
      throw new TypeError('Kovo browser control returned a non-native promise.');
    }
    observePromiseRejection(value as Promise<unknown>);
    return await (value as Promise<Value>);
  }

  async function validateResponseControls(): Promise<void> {
    if (!NativeResponse || !responseHeaders || !responseStatus || !responseText || !headersGet) {
      throw new TypeError('Kovo navigation response witness controls are unavailable.');
    }
    const response = new NativeResponse('kovo-response-control-async', {
      headers: { 'Kovo-Build': 'kovo-response-build-async' },
      status: 203,
    });
    const plan = nativeFetchResponsePlan(response);
    if (
      !plan ||
      plan.status !== 203 ||
      readFetchResponseHeader(plan, 'Kovo-Build') !== 'kovo-response-build-async'
    ) {
      throw new TypeError('Kovo navigation response controls did not pass their boot witness.');
    }
    const text = await awaitNativePromise<unknown>(apply(responseText, response, []));
    if (text !== 'kovo-response-control-async') {
      throw new TypeError('Kovo navigation response controls changed witnessed response bytes.');
    }
    responseControlsVerified = true;
  }

  async function requireResponseControls(): Promise<void> {
    if (!responseControlsReady) {
      throw new TypeError('Kovo navigation response controls are unavailable.');
    }
    await awaitNativePromise(responseControlsReady);
    if (!responseControlsVerified) {
      throw new TypeError('Kovo navigation response controls have not passed their boot witness.');
    }
  }

  function readStreamLocked(stream: object): boolean {
    if (!readableStreamLocked) {
      throw new TypeError('Kovo mutation stream lock control is unavailable.');
    }
    const locked = call<unknown>(readableStreamLocked, stream, []);
    if (typeof locked !== 'boolean') {
      throw new TypeError('Kovo mutation stream lock control returned invalid data.');
    }
    return locked;
  }

  function acquireStreamReaderRaw(stream: object): BrowserStreamReaderPlan {
    if (!readableStreamGetReader || readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream is unavailable or already locked.');
    }
    const reader = call<unknown>(readableStreamGetReader, stream, []);
    if (reader === null || typeof reader !== 'object' || !readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream reader acquisition returned invalid data.');
    }
    return [
      stream as ReadableStream<Uint8Array>,
      reader as ReadableStreamDefaultReader<Uint8Array>,
      streamReaderPlanWitness,
    ];
  }

  function readStreamReaderPlan(plan: BrowserStreamReaderPlan): {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    stream: ReadableStream<Uint8Array>;
  } {
    if (
      plan === null ||
      typeof plan !== 'object' ||
      readOwnData(plan, '2') !== streamReaderPlanWitness
    ) {
      throw new TypeError('Kovo mutation stream reader plan is not framework-owned.');
    }
    const stream = readOwnData(plan, '0');
    const reader = readOwnData(plan, '1');
    if (
      reader === null ||
      typeof reader !== 'object' ||
      stream === null ||
      typeof stream !== 'object'
    ) {
      throw new TypeError('Kovo mutation stream reader plan is invalid.');
    }
    return {
      reader: reader as ReadableStreamDefaultReader<Uint8Array>,
      stream: stream as ReadableStream<Uint8Array>,
    };
  }

  function snapshotStreamChunk(value: unknown): Uint8Array {
    if (!NativeUint8Array || !uint8ArrayByteLength || value === null || typeof value !== 'object') {
      throw new TypeError('Kovo mutation stream returned a non-Uint8Array chunk.');
    }
    const byteLength = call<unknown>(uint8ArrayByteLength, value, []);
    if (
      typeof byteLength !== 'number' ||
      byteLength < 0 ||
      byteLength % 1 !== 0 ||
      byteLength > 0xffff_ffff
    ) {
      throw new TypeError('Kovo mutation stream returned an invalid byte length.');
    }
    let owner = prototypeOf(value);
    let nativeUint8Array = false;
    for (let depth = 0; owner !== null && depth < 16; depth += 1) {
      if (owner === NativeUint8Array.prototype) {
        nativeUint8Array = true;
        break;
      }
      owner = prototypeOf(owner);
    }
    if (!nativeUint8Array) {
      throw new TypeError('Kovo mutation stream returned a foreign typed-array chunk.');
    }
    if (!uint8ArraySet) {
      throw new TypeError('Kovo mutation stream byte-copy control is unavailable.');
    }
    // SPEC §6.6/§9.1: allocate the private snapshot explicitly and copy through the captured
    // intrinsic. TypedArray slice/species and caller buffer constructors must never select the
    // carrier for unclassified server bytes.
    const snapshot = new NativeUint8Array(byteLength);
    call(uint8ArraySet, snapshot, [value, 0]);
    if (call<unknown>(uint8ArrayByteLength, snapshot, []) !== byteLength) {
      throw new TypeError('Kovo mutation stream byte snapshot changed length.');
    }
    return snapshot;
  }

  async function readStreamChunkRaw(
    plan: BrowserStreamReaderPlan,
  ): Promise<BrowserStreamChunkSnapshot> {
    const { reader, stream } = readStreamReaderPlan(plan);
    if (!readerRead || !readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream reader control is unavailable.');
    }
    const raw = await awaitNativePromise<unknown>(call(readerRead, reader, []));
    if (raw === null || typeof raw !== 'object' || !readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream read returned invalid data.');
    }
    const doneDescriptor = descriptor(raw, 'done');
    if (
      !doneDescriptor ||
      !('value' in doneDescriptor) ||
      typeof doneDescriptor.value !== 'boolean'
    ) {
      throw new TypeError('Kovo mutation stream read returned an invalid done flag.');
    }
    if (doneDescriptor.value) return { done: true };
    const valueDescriptor = descriptor(raw, 'value');
    if (!valueDescriptor || !('value' in valueDescriptor)) {
      throw new TypeError('Kovo mutation stream read returned an invalid chunk carrier.');
    }
    return { done: false, value: snapshotStreamChunk(valueDescriptor.value) };
  }

  async function cancelReadableStreamRaw(stream: object): Promise<void> {
    if (!readableStreamCancel || readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream cancel control is unavailable.');
    }
    await awaitNativePromise(call(readableStreamCancel, stream, []));
    if (readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream cancel changed its lock posture.');
    }
  }

  async function cancelStreamReaderRaw(plan: BrowserStreamReaderPlan): Promise<void> {
    const { reader, stream } = readStreamReaderPlan(plan);
    if (!readerCancel || !readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation reader cancel control is unavailable.');
    }
    await awaitNativePromise(call(readerCancel, reader, []));
    if (!readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation reader cancel released the bound stream unexpectedly.');
    }
  }

  function releaseStreamReaderRaw(plan: BrowserStreamReaderPlan): void {
    const { reader, stream } = readStreamReaderPlan(plan);
    if (!readerReleaseLock || !readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream release control is unavailable.');
    }
    call(readerReleaseLock, reader, []);
    if (readStreamLocked(stream)) {
      throw new TypeError('Kovo mutation stream reader failed to release its bound stream.');
    }
  }

  async function validateStreamControls(): Promise<void> {
    if (!NativeResponse || !responseBody || !NativeUint8Array || !uint8ArrayByteLength) {
      throw new TypeError('Kovo mutation stream witness controls are unavailable.');
    }
    const expected = new NativeUint8Array([0x4b, 0x56, 0x4f]);
    const response = new NativeResponse(expected);
    const body = call<unknown>(responseBody, response, []);
    if (body === null || typeof body !== 'object') {
      throw new TypeError('Kovo mutation stream witness body is unavailable.');
    }
    const plan = acquireStreamReaderRaw(body);
    try {
      const first = await readStreamChunkRaw(plan);
      if (
        first.done ||
        call<unknown>(uint8ArrayByteLength, first.value, []) !== 3 ||
        first.value[0] !== 0x4b ||
        first.value[1] !== 0x56 ||
        first.value[2] !== 0x4f
      ) {
        throw new TypeError('Kovo mutation stream witness bytes changed before parsing.');
      }
      const done = await readStreamChunkRaw(plan);
      if (!done.done) {
        throw new TypeError('Kovo mutation stream witness did not terminate exactly once.');
      }
    } finally {
      releaseStreamReaderRaw(plan);
    }

    const cancelResponse = new NativeResponse(expected);
    const cancelBody = call<unknown>(responseBody, cancelResponse, []);
    if (cancelBody === null || typeof cancelBody !== 'object') {
      throw new TypeError('Kovo mutation stream cancel witness body is unavailable.');
    }
    const cancelPlan = acquireStreamReaderRaw(cancelBody);
    try {
      await cancelStreamReaderRaw(cancelPlan);
      const cancelled = await readStreamChunkRaw(cancelPlan);
      if (!cancelled.done) {
        throw new TypeError('Kovo mutation stream cancel witness retained unread bytes.');
      }
    } finally {
      releaseStreamReaderRaw(cancelPlan);
    }

    const directCancelResponse = new NativeResponse(expected);
    const directCancelBody = call<unknown>(responseBody, directCancelResponse, []);
    if (directCancelBody === null || typeof directCancelBody !== 'object') {
      throw new TypeError('Kovo mutation direct-cancel witness body is unavailable.');
    }
    await cancelReadableStreamRaw(directCancelBody);
    const directCancelPlan = acquireStreamReaderRaw(directCancelBody);
    try {
      const cancelled = await readStreamChunkRaw(directCancelPlan);
      if (!cancelled.done) {
        throw new TypeError('Kovo mutation direct-cancel witness retained unread bytes.');
      }
    } finally {
      releaseStreamReaderRaw(directCancelPlan);
    }
    streamControlsVerified = true;
  }

  async function requireStreamControls(): Promise<void> {
    if (!streamControlsReady) {
      throw new TypeError('Kovo mutation stream controls are unavailable.');
    }
    await awaitNativePromise(streamControlsReady);
  }

  async function acquireStreamReader(stream: object): Promise<BrowserStreamReaderPlan> {
    await requireStreamControls();
    return acquireStreamReaderRaw(stream);
  }

  function requireVerifiedStreamControls(): void {
    if (!streamControlsVerified) {
      throw new TypeError('Kovo mutation stream controls have not passed their boot witness.');
    }
  }

  function readStreamChunk(plan: BrowserStreamReaderPlan): Promise<BrowserStreamChunkSnapshot> {
    requireVerifiedStreamControls();
    return readStreamChunkRaw(plan);
  }

  function cancelReadableStream(stream: object): Promise<void> {
    return cancelReadableStreamRaw(stream);
  }

  function cancelStreamReader(plan: BrowserStreamReaderPlan): Promise<void> {
    requireVerifiedStreamControls();
    return cancelStreamReaderRaw(plan);
  }

  function releaseStreamReader(plan: BrowserStreamReaderPlan): void {
    requireVerifiedStreamControls();
    releaseStreamReaderRaw(plan);
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

  function readPageTransitionPersisted(event: unknown): boolean {
    // SPEC §8: uncertainty at this session-revalidation branch fails toward a full
    // reload. Browser events are read through the witnessed native WebIDL getter;
    // the own-data fallback exists only for non-browser/test scopes without the
    // PageTransitionEvent constructor.
    if (!controlsSound || event === null || typeof event !== 'object') return true;
    let value: unknown;
    if (pageTransitionPersisted) {
      try {
        value = apply(pageTransitionPersisted, event, []);
      } catch {
        return true;
      }
    } else {
      value = readOwnData(event, 'persisted');
    }
    return value === false ? false : true;
  }

  function freezeBrowserSnapshot<Value extends object>(value: Value): Value {
    const frozen = call<unknown>(nativeObjectFreeze, NativeObject, [value]);
    if (frozen !== value || call<unknown>(nativeObjectIsFrozen, NativeObject, [value]) !== true) {
      throw new TypeError('Kovo browser snapshot freeze control returned invalid data.');
    }
    return value;
  }

  function readOwnArrayLength(value: object): number | undefined {
    const length = descriptor(value, 'length');
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      length.value < 0 ||
      length.value % 1 !== 0 ||
      length.value > 100_000
    ) {
      return undefined;
    }
    return length.value;
  }

  function snapshotBroadcastKeys(value: unknown): readonly string[] | undefined {
    if (
      value === null ||
      typeof value !== 'object' ||
      call<unknown>(nativeArrayIsArray, NativeArray, [value]) !== true
    ) {
      return undefined;
    }
    const length = readOwnArrayLength(value);
    if (length === undefined) return undefined;
    const keys: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const entry = descriptor(value, index);
      if (!entry || !('value' in entry) || typeof entry.value !== 'string') return undefined;
      appendDenseSecurityValue(keys, entry.value, 'Kovo broadcast key snapshot');
    }
    return freezeBrowserSnapshot(keys);
  }

  function snapshotBroadcastChange(
    value: unknown,
  ): BrowserMutationBroadcastChangeSnapshot | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    const domain = descriptor(value, 'domain');
    if (!domain || !('value' in domain) || typeof domain.value !== 'string') return undefined;
    const keys = descriptor(value, 'keys');
    if (keys && !('value' in keys)) return undefined;
    const keysSnapshot = keys ? snapshotBroadcastKeys(keys.value) : undefined;
    if (keys && keysSnapshot === undefined) return undefined;
    return freezeBrowserSnapshot(
      keysSnapshot === undefined
        ? { domain: domain.value }
        : { domain: domain.value, keys: keysSnapshot },
    );
  }

  function snapshotMutationBroadcastEnvelopeData(
    value: unknown,
  ): BrowserMutationBroadcastEnvelopeSnapshot | undefined {
    if (!controlsSound || value === null || typeof value !== 'object') return undefined;
    const type = descriptor(value, 'type');
    const body = descriptor(value, 'body');
    const changes = descriptor(value, 'changes');
    if (
      !type ||
      !('value' in type) ||
      type.value !== 'kovo:mutation-response' ||
      !body ||
      !('value' in body) ||
      typeof body.value !== 'string' ||
      !changes ||
      !('value' in changes) ||
      changes.value === null ||
      typeof changes.value !== 'object' ||
      call<unknown>(nativeArrayIsArray, NativeArray, [changes.value]) !== true
    ) {
      return undefined;
    }
    const changeCount = readOwnArrayLength(changes.value);
    if (changeCount === undefined) return undefined;
    const changeSnapshots: BrowserMutationBroadcastChangeSnapshot[] = [];
    for (let index = 0; index < changeCount; index += 1) {
      const entry = descriptor(changes.value, index);
      if (!entry || !('value' in entry)) return undefined;
      const snapshot = snapshotBroadcastChange(entry.value);
      if (!snapshot) return undefined;
      appendDenseSecurityValue(changeSnapshots, snapshot, 'Kovo broadcast change snapshot');
    }
    const buildToken = descriptor(value, 'buildToken');
    const principal = descriptor(value, 'principal');
    if (
      (buildToken && (!('value' in buildToken) || typeof buildToken.value !== 'string')) ||
      (principal && (!('value' in principal) || typeof principal.value !== 'string'))
    ) {
      return undefined;
    }
    const frozenChanges = freezeBrowserSnapshot(changeSnapshots);
    const envelope: {
      body: string;
      buildToken?: string;
      changes: readonly BrowserMutationBroadcastChangeSnapshot[];
      principal?: string;
      type: 'kovo:mutation-response';
    } = {
      body: body.value,
      changes: frozenChanges,
      type: 'kovo:mutation-response',
    };
    if (buildToken && 'value' in buildToken) envelope.buildToken = buildToken.value as string;
    if (principal && 'value' in principal) envelope.principal = principal.value as string;
    return freezeBrowserSnapshot(envelope);
  }

  function snapshotMutationBroadcastEnvelope(
    event: unknown,
  ): BrowserMutationBroadcastEnvelopeSnapshot | undefined {
    if (!controlsSound || event === null || typeof event !== 'object') return undefined;
    let value: unknown;
    if (messageEventData) {
      try {
        value = apply(messageEventData, event, []);
      } catch {
        // Node conformance fixtures use own-data event carriers and expose no
        // native Document constructor. A browser realm never takes this seam:
        // unbrandable MessageEvent receivers fail closed before envelope reads.
        if (NativeDocument) return undefined;
        value = readOwnData(event, 'data');
      }
    } else {
      value = readOwnData(event, 'data');
    }
    return snapshotMutationBroadcastEnvelopeData(value);
  }

  function createMutationBroadcastChannel(name: string): BroadcastChannel | undefined {
    if (!controlsSound || typeof name !== 'string') return undefined;
    // Browser realms may only use the constructor captured and brand-witnessed at
    // framework initialization. The no-Document branch is the explicit Node test
    // seam, where conformance fixtures install a BroadcastChannel-like constructor.
    if (NativeDocument) {
      if (!NativeBroadcastChannel || !broadcastChannelName || !broadcastChannelClose) {
        return undefined;
      }
      const channel = new NativeBroadcastChannel(name);
      const actualName = call<unknown>(broadcastChannelName, channel, []);
      if (actualName !== name) {
        call(broadcastChannelClose, channel, []);
        throw new TypeError('Kovo mutation broadcast constructor changed its channel name.');
      }
      return channel;
    }
    const CurrentBroadcastChannel = scope.BroadcastChannel;
    if (typeof CurrentBroadcastChannel !== 'function') return undefined;
    return new CurrentBroadcastChannel(name);
  }

  async function validateBroadcastControls(): Promise<void> {
    if (
      !NativeDocument ||
      !NativeBroadcastChannel ||
      !broadcastChannelName ||
      !broadcastChannelPostMessage ||
      !broadcastChannelClose ||
      !broadcastChannelOnMessageSetter ||
      !broadcastChannelOnMessage ||
      !nativeSetTimeout ||
      !nativeClearTimeout ||
      !broadcastWitnessPrincipal
    ) {
      throw new TypeError('Kovo mutation broadcast witness controls are unavailable.');
    }
    const channelName = 'kovo:mutation-response';
    const sender = new NativeBroadcastChannel(channelName);
    const receiver = new NativeBroadcastChannel(channelName);
    const closeControl = new NativeBroadcastChannel(channelName);
    let timeoutHandle: unknown;
    try {
      if (
        call<unknown>(broadcastChannelName, sender, []) !== channelName ||
        call<unknown>(broadcastChannelName, receiver, []) !== channelName ||
        call<unknown>(broadcastChannelName, closeControl, []) !== channelName
      ) {
        throw new TypeError('Kovo mutation broadcast witness changed its channel name.');
      }
      const principal = broadcastWitnessPrincipal;
      const body = '<kovo-done reason="broadcast-security-control"></kovo-done>';
      const envelope = snapshotMutationBroadcastEnvelopeData({
        body,
        buildToken: principal,
        changes: [{ domain: 'kovo-broadcast-control', keys: [principal] }],
        principal,
        type: 'kovo:mutation-response',
      });
      if (!envelope) {
        throw new TypeError('Kovo mutation broadcast witness envelope is unavailable.');
      }
      const received = new NativePromise<BrowserMutationBroadcastEnvelopeSnapshot>(
        (resolve, reject) => {
          const onMessage = (event: unknown) => {
            const snapshot = snapshotMutationBroadcastEnvelope(event);
            if (snapshot?.principal === principal) resolve(snapshot);
          };
          call(broadcastChannelOnMessageSetter, receiver, [onMessage]);
          if (call<unknown>(broadcastChannelOnMessage, receiver, []) !== onMessage) {
            throw new TypeError('Kovo mutation broadcast witness did not install its handler.');
          }
          timeoutHandle = call(nativeSetTimeout, scope, [
            () =>
              reject(
                new TypeError('Kovo mutation broadcast controls did not pass their boot witness.'),
              ),
            2_000,
          ]);
        },
      );
      observePromiseRejection(received);
      call(broadcastChannelPostMessage, sender, [envelope]);
      const snapshot = await awaitNativePromise<BrowserMutationBroadcastEnvelopeSnapshot>(received);
      if (
        snapshot.body !== body ||
        snapshot.buildToken !== principal ||
        snapshot.principal !== principal ||
        snapshot.type !== 'kovo:mutation-response' ||
        snapshot.changes.length !== 1 ||
        snapshot.changes[0]?.domain !== 'kovo-broadcast-control' ||
        snapshot.changes[0]?.keys?.length !== 1 ||
        snapshot.changes[0]?.keys?.[0] !== principal ||
        call<unknown>(nativeObjectIsFrozen, NativeObject, [snapshot]) !== true ||
        call<unknown>(nativeObjectIsFrozen, NativeObject, [snapshot.changes]) !== true ||
        call<unknown>(nativeObjectIsFrozen, NativeObject, [snapshot.changes[0]]) !== true ||
        call<unknown>(nativeObjectIsFrozen, NativeObject, [snapshot.changes[0]?.keys]) !== true
      ) {
        throw new TypeError('Kovo mutation broadcast witness changed the published envelope.');
      }
      call(broadcastChannelOnMessageSetter, receiver, [null]);
      if (call<unknown>(broadcastChannelOnMessage, receiver, []) !== null) {
        throw new TypeError('Kovo mutation broadcast witness did not clear its handler.');
      }
      call(broadcastChannelClose, closeControl, []);
      let rejectedClosedPost = false;
      try {
        call(broadcastChannelPostMessage, closeControl, [envelope]);
      } catch {
        rejectedClosedPost = true;
      }
      if (!rejectedClosedPost) {
        throw new TypeError('Kovo mutation broadcast witness did not close its channel.');
      }
      broadcastControlsVerified = true;
    } finally {
      if (timeoutHandle !== undefined) call(nativeClearTimeout, scope, [timeoutHandle]);
      try {
        call(broadcastChannelOnMessageSetter, receiver, [null]);
      } catch {}
      try {
        call(broadcastChannelClose, sender, []);
      } catch {}
      try {
        call(broadcastChannelClose, receiver, []);
      } catch {}
      try {
        call(broadcastChannelClose, closeControl, []);
      } catch {}
    }
  }

  async function requireBroadcastControls(): Promise<void> {
    if (!broadcastControlsReady) {
      throw new TypeError('Kovo mutation broadcast controls are unavailable.');
    }
    await awaitNativePromise(broadcastControlsReady);
    if (!broadcastControlsVerified) {
      throw new TypeError('Kovo mutation broadcast controls have not passed their boot witness.');
    }
  }

  async function setMutationBroadcastMessageHandler(
    channel: object,
    handler: ((event: MessageEvent<unknown>) => void) | null,
    isRetired?: () => boolean,
  ): Promise<void> {
    if (handler !== null && typeof handler !== 'function') {
      throw new TypeError('Kovo mutation broadcast message handler is invalid.');
    }
    if (mutationBroadcastIsRetired(isRetired)) return;
    if (!NativeDocument) {
      // Explicit Node conformance seam: browser realms always take the captured,
      // witnessed WebIDL setter below.
      (channel as { onmessage: ((event: MessageEvent<unknown>) => void) | null }).onmessage =
        handler;
      return;
    }
    // The async witness validates constructor → setter → MessageEvent.data delivery.
    // Do not expose the application handler before that chain is proven: a poisoned
    // pre-boot setter could otherwise forge a brand-valid MessageEvent synchronously.
    if (!broadcastControlsVerified) await requireBroadcastControls();
    if (mutationBroadcastIsRetired(isRetired)) return;
    if (!broadcastChannelName || !broadcastChannelOnMessageSetter) {
      throw new TypeError('Kovo mutation broadcast controls are unavailable.');
    }
    let name: unknown;
    try {
      name = call<unknown>(broadcastChannelName, channel, []);
    } catch {
      throw new TypeError('Kovo mutation broadcast channel is not platform-owned.');
    }
    if (typeof name !== 'string') {
      throw new TypeError('Kovo mutation broadcast channel name is invalid.');
    }
    call(broadcastChannelOnMessageSetter, channel, [handler]);
  }

  function mutationBroadcastIsRetired(isRetired: (() => boolean) | undefined): boolean {
    if (!isRetired) return false;
    try {
      return isRetired() === true;
    } catch {
      return true;
    }
  }

  function retireMutationBroadcastChannel(channel: object): void {
    if (!controlsSound || channel === null || typeof channel !== 'object') return;
    if (!NativeDocument) {
      try {
        (channel as { onmessage: ((event: MessageEvent<unknown>) => void) | null }).onmessage =
          null;
      } catch {}
      const customClose = stableMethod(channel, 'close');
      if (customClose) {
        try {
          call(customClose, channel, []);
        } catch {}
      }
      return;
    }
    if (!broadcastChannelName || !broadcastChannelOnMessageSetter || !broadcastChannelClose) return;
    try {
      if (typeof call<unknown>(broadcastChannelName, channel, []) !== 'string') return;
    } catch {
      return;
    }
    try {
      call(broadcastChannelOnMessageSetter, channel, [null]);
    } catch {}
    try {
      call(broadcastChannelClose, channel, []);
    } catch {}
  }

  async function postMutationBroadcastEnvelope(
    channel: object,
    value: unknown,
    isRetired?: () => boolean,
  ): Promise<void> {
    // Copy before the first await: callers cannot mutate, accessor-swap, or retain
    // an extra field across the asynchronous boot witness boundary.
    if (mutationBroadcastIsRetired(isRetired)) return;
    const envelope = snapshotMutationBroadcastEnvelopeData(value);
    if (!envelope) throw new TypeError('Kovo mutation broadcast envelope is invalid.');
    if (!NativeDocument) {
      const customPostMessage = stableMethod(channel, 'postMessage');
      if (!customPostMessage) {
        throw new TypeError('Kovo mutation broadcast test transport is unavailable.');
      }
      call(customPostMessage, channel, [envelope]);
      return;
    }
    await requireBroadcastControls();
    if (mutationBroadcastIsRetired(isRetired)) return;
    if (!broadcastChannelName || !broadcastChannelPostMessage) {
      throw new TypeError('Kovo mutation broadcast controls are unavailable.');
    }
    let name: unknown;
    try {
      name = call<unknown>(broadcastChannelName, channel, []);
    } catch {
      throw new TypeError('Kovo mutation broadcast channel is not platform-owned.');
    }
    if (typeof name !== 'string') {
      throw new TypeError('Kovo mutation broadcast channel name is invalid.');
    }
    call(broadcastChannelPostMessage, channel, [envelope]);
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
    if (!controlsSound || !NativeURL || typeof value !== 'string') return undefined;
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

  function createFormData(form: HTMLFormElement, submitter?: HTMLElement | null): FormData {
    if (!controlsSound || !NativeFormData) {
      throw new TypeError('Kovo form-data constructor control is unavailable.');
    }
    return new NativeFormData(form, submitter);
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

  function setFormDataValue(formData: unknown, name: string, value: string): void {
    if (
      !controlsSound ||
      formData === null ||
      typeof formData !== 'object' ||
      typeof name !== 'string' ||
      typeof value !== 'string'
    ) {
      throw new TypeError('Kovo form-data setter control is unavailable.');
    }
    let nativeReceiver = false;
    if (formDataGet) {
      try {
        apply(formDataGet, formData, ['kovo-form-data-receiver-control']);
        nativeReceiver = true;
      } catch {}
    }
    const setter = nativeReceiver ? formDataSet : stableMethod(formData, 'set');
    if (!setter) {
      // Browser-free transport fakes may carry no form fields at all. A header-only carrier has
      // no competing replay authority; a read-only carrier that already contains an idem does,
      // and must fail closed rather than send mismatched body/header truth.
      const existing = readFormDataValue(formData, name);
      if (existing === undefined || existing === null || existing === '') return;
      throw new TypeError('Kovo form-data setter control is unavailable.');
    }
    apply(setter, formData, [name, value]);
    if (readFormDataValue(formData, name) !== value) {
      throw new TypeError('Kovo form-data setter control did not commit the exact value.');
    }
  }

  function freezeFetchHeaderSnapshot(
    headers: object | undefined,
    getHeader: Function | undefined,
  ): readonly (readonly [string, string | undefined])[] {
    if (!headers || !getHeader) return apply(nativeObjectFreeze, NativeObject, [[]]);
    const snapshot: Array<readonly [string, string | undefined]> = [];
    for (let index = 0; index < fetchHeaderNames.length; index += 1) {
      const names = fetchHeaderNames[index];
      if (!names) continue;
      const value = apply<unknown>(getHeader, headers, [names[1]]);
      if (value !== null && value !== undefined && typeof value !== 'string') {
        throw new TypeError('Kovo navigation response header is invalid.');
      }
      const entry = apply<readonly [string, string | undefined]>(nativeObjectFreeze, NativeObject, [
        [names[0], typeof value === 'string' ? value : undefined],
      ]);
      apply(nativeObjectDefineProperty, NativeObject, [
        snapshot,
        snapshot.length,
        {
          configurable: false,
          enumerable: true,
          value: entry,
          writable: false,
        },
      ]);
    }
    return apply(nativeObjectFreeze, NativeObject, [snapshot]);
  }

  function nativeFetchResponsePlan(response: object): BrowserFetchResponsePlan | undefined {
    if (
      !responseBody ||
      !responseHeaders ||
      !responseOk ||
      !responseRedirected ||
      !responseStatus ||
      !responseUrl ||
      !responseText ||
      !headersGet
    ) {
      return undefined;
    }
    try {
      const headers = apply<unknown>(responseHeaders, response, []);
      if (headers === null || typeof headers !== 'object') return undefined;
      const plan: BrowserFetchResponsePlan = {
        body: apply(responseBody, response, []),
        headers: freezeFetchHeaderSnapshot(headers, headersGet),
        ok: apply(responseOk, response, []),
        redirected: apply(responseRedirected, response, []),
        status: apply(responseStatus, response, []),
        textMethod: responseText,
        textReceiver: response,
        url: apply(responseUrl, response, []),
      };
      return apply(nativeObjectFreeze, NativeObject, [plan]);
    } catch {
      return undefined;
    }
  }

  function ownDataResponseField(response: object, field: PropertyKey): unknown {
    const found = descriptor(response, field);
    if (found === undefined) return undefined;
    if (!('value' in found)) {
      throw new TypeError('Kovo structural navigation response fields must be own data.');
    }
    return found.value;
  }

  function structuralFetchResponsePlan(response: object): BrowserFetchResponsePlan | undefined {
    try {
      const headersValue = ownDataResponseField(response, 'headers');
      let headerReader: Function | undefined;
      if (headersValue !== undefined) {
        if (headersValue === null || typeof headersValue !== 'object') return undefined;
        if (headersGet) {
          try {
            apply(headersGet, headersValue, ['kovo-structural-control']);
            headerReader = headersGet;
          } catch {}
        }
        headerReader ??= valueMethod(headersValue, 'get');
        if (!headerReader) return undefined;
      }
      const textValue = ownDataResponseField(response, 'text');
      if (textValue !== undefined && typeof textValue !== 'function') return undefined;
      const body = ownDataResponseField(response, 'body');
      if (typeof textValue !== 'function' && (body === null || body === undefined)) {
        return undefined;
      }
      const plan: BrowserFetchResponsePlan = {
        body,
        headers: freezeFetchHeaderSnapshot(
          headersValue !== null && typeof headersValue === 'object' ? headersValue : undefined,
          headerReader,
        ),
        ok: ownDataResponseField(response, 'ok'),
        redirected: ownDataResponseField(response, 'redirected'),
        status: ownDataResponseField(response, 'status'),
        ...(typeof textValue === 'function' ? { textMethod: textValue } : {}),
        textReceiver: response,
        url: ownDataResponseField(response, 'url'),
      };
      return apply(nativeObjectFreeze, NativeObject, [plan]);
    } catch {
      return undefined;
    }
  }

  function bindFetchResponseCarrier(response: unknown): object {
    if (response === null || typeof response !== 'object') {
      throw new TypeError('Kovo navigation fetch returned an invalid response carrier.');
    }
    if (fetchResponsePlan(response)) return response;
    const plan = nativeFetchResponsePlan(response) ?? structuralFetchResponsePlan(response);
    if (!plan) {
      throw new TypeError('Kovo navigation fetch returned an invalid response carrier.');
    }
    rememberFetchResponsePlan(response, plan);
    return response;
  }

  function readFetchResponseHeader(
    plan: BrowserFetchResponsePlan,
    name: string,
  ): string | undefined {
    const normalized = lower(name);
    for (let index = 0; index < plan.headers.length; index += 1) {
      const entry = plan.headers[index];
      if (entry?.[0] === normalized) return entry[1];
    }
    return undefined;
  }

  function readHeader(response: unknown, name: string): string | undefined {
    if (!controlsSound || response === null || typeof response !== 'object') return undefined;
    const plan = fetchResponsePlan(response);
    if (plan) return readFetchResponseHeader(plan, name);
    if (!responseHeaders || !headersGet) return undefined;
    try {
      const headers = apply<unknown>(responseHeaders, response, []);
      if (headers === null || typeof headers !== 'object') return undefined;
      const value = apply<unknown>(headersGet, headers, [name]);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  function readResponseField(
    response: unknown,
    field: 'body' | 'ok' | 'redirected' | 'status' | 'url',
  ): unknown {
    if (!controlsSound || response === null || typeof response !== 'object') return undefined;
    const plan = fetchResponsePlan(response);
    if (plan) return plan[field];
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
    return undefined;
  }

  async function readResponseText(response: unknown): Promise<string> {
    if (!controlsSound || response === null || typeof response !== 'object') {
      throw new TypeError('Kovo navigation response is invalid.');
    }
    const plan = fetchResponsePlan(response);
    let method = plan?.textMethod;
    let receiver = plan?.textReceiver;
    if (!method && responseText && responseHeaders) {
      try {
        apply(responseHeaders, response, []);
        method = responseText;
        receiver = response;
      } catch {}
    }
    if (!method || !receiver) {
      throw new TypeError('Kovo navigation response text is unavailable.');
    }
    const pending = apply<unknown>(method, receiver, []);
    const value = await awaitNativePromise<unknown>(pending);
    if (typeof value !== 'string') throw new TypeError('Kovo response text is invalid.');
    return value;
  }

  async function readResponseTextOptionalSync(response: unknown): Promise<string> {
    if (!controlsSound || response === null || typeof response !== 'object') {
      throw new TypeError('Kovo navigation response is invalid.');
    }
    const plan = fetchResponsePlan(response);
    let method = plan?.textMethod;
    let receiver = plan?.textReceiver;
    if (!method && responseText && responseHeaders) {
      try {
        apply(responseHeaders, response, []);
        method = responseText;
        receiver = response;
      } catch {}
    }
    if (!method || !receiver) {
      throw new TypeError('Kovo navigation response text is unavailable.');
    }
    const pending = apply<unknown>(method, receiver, []);
    const value =
      typeof pending === 'string' ? pending : await awaitNativePromise<unknown>(pending);
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

  async function fetchWith(
    fetchControl: Function | undefined,
    receiver: unknown,
    input: string,
    init: object,
  ): Promise<unknown> {
    // C230 / SPEC §6.6/§9.1: transport invocation preserves the existing synchronous-start
    // contract, but no response fact escapes until the boot witness, native Promise brand, and
    // native/own-data Response carrier plan have all passed.
    if (!controlsSound || !fetchControl) {
      throw new TypeError('Kovo navigation fetch is unavailable.');
    }
    const pending = apply<unknown>(fetchControl, receiver, [input, init]);
    await requireResponseControls();
    const response = await awaitNativePromise<unknown>(pending);
    return bindFetchResponseCarrier(response);
  }

  async function fetchWithOptionalSyncResult(
    fetchControl: Function | undefined,
    receiver: unknown,
    input: string,
    init: object,
  ): Promise<unknown> {
    // Modular typed-read transports historically allow a direct structural Response in tests and
    // adapters. Preserve that contract without Promise.resolve/`await` thenable assimilation: a
    // native Promise is recognized through the captured brand method; every other value is bound
    // directly as a response carrier and its `then` field, if any, is never invoked.
    if (!controlsSound || !fetchControl) {
      throw new TypeError('Kovo navigation fetch is unavailable.');
    }
    const pending = apply<unknown>(fetchControl, receiver, [input, init]);
    await requireResponseControls();
    let response = pending;
    if (pending !== null && typeof pending === 'object') {
      try {
        observePromiseRejection(pending as Promise<unknown>);
        response = await awaitNativePromise(pending);
      } catch (error) {
        // A real native Promise rejection must retain its transport error. Only a failed brand
        // probe falls back to the synchronous response-carrier path.
        try {
          apply(nativePromiseThen, pending, [undefined, () => undefined]);
        } catch {
          if (stableMethod(pending, 'then')) {
            throw new TypeError('Kovo synchronous response carriers cannot be thenable.');
          }
          return bindFetchResponseCarrier(pending);
        }
        throw error;
      }
    }
    return bindFetchResponseCarrier(response);
  }

  async function fetchDocument(href: string, accept: string): Promise<unknown> {
    return fetchWith(browserFetch, scope, href, { headers: { Accept: accept } });
  }

  async function fetchValue(input: string, init: object): Promise<unknown> {
    return fetchWith(browserFetch, scope, input, init);
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

  function hasReloadControl(): boolean {
    return controlsSound && locationObject !== undefined && locationReload !== undefined;
  }

  function reload(): unknown {
    if (!hasReloadControl()) return undefined;
    try {
      return apply(locationReload as Function, locationObject, []);
    } catch {
      return undefined;
    }
  }

  function controlsAreSound(): boolean {
    try {
      if (
        typeof nativeReflectApply !== 'function' ||
        typeof nativeObjectDefineProperty !== 'function' ||
        typeof nativeObjectGetOwnPropertyDescriptor !== 'function' ||
        typeof nativeObjectGetPrototypeOf !== 'function' ||
        typeof nativeObjectFreeze !== 'function' ||
        typeof nativeObjectIsFrozen !== 'function' ||
        typeof nativeArrayIsArray !== 'function' ||
        typeof nativeMapGet !== 'function' ||
        typeof nativeMapHas !== 'function' ||
        typeof nativeMapSet !== 'function' ||
        typeof nativePromiseThen !== 'function' ||
        typeof nativeWeakMapGet !== 'function' ||
        typeof nativeWeakMapHas !== 'function' ||
        typeof nativeWeakMapSet !== 'function' ||
        typeof nativeRegExpExec !== 'function' ||
        typeof nativeRegExpTest !== 'function' ||
        typeof nativeDecodeURIComponent !== 'function' ||
        typeof NativeAbortController !== 'function' ||
        typeof NativeAbortSignal !== 'function' ||
        !abortControllerAbort ||
        !abortControllerSignal ||
        !abortSignalAborted ||
        typeof NativeURL !== 'function' ||
        typeof browserFetch !== 'function' ||
        !urlHref ||
        !urlOrigin ||
        !urlPathname ||
        !urlSearch ||
        !urlHash ||
        !NativeTextDecoder ||
        !NativeUint8Array ||
        !NativeReadableStream ||
        !NativeReadableStreamDefaultReader ||
        !textDecoderDecode ||
        !uint8ArrayByteLength ||
        !uint8ArraySet ||
        !readableStreamCancel ||
        !readableStreamGetReader ||
        !readableStreamLocked ||
        !readerCancel ||
        !readerRead ||
        !readerReleaseLock
      ) {
        return false;
      }
      if (apply<number>((left: number, right: number) => left + right, undefined, [2, 3]) !== 5) {
        return false;
      }
      const fetchControlDescriptor = descriptor(scope, 'fetch');
      if (
        !fetchControlDescriptor ||
        !('value' in fetchControlDescriptor) ||
        fetchControlDescriptor.value !== browserFetch
      ) {
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
      const freezeControl = { marker: 'kovo-browser-snapshot' };
      if (
        apply<unknown>(nativeObjectFreeze, NativeObject, [freezeControl]) !== freezeControl ||
        apply<unknown>(nativeObjectIsFrozen, NativeObject, [freezeControl]) !== true ||
        apply<unknown>(nativeArrayIsArray, NativeArray, [[]]) !== true ||
        apply<unknown>(nativeArrayIsArray, NativeArray, [{}]) !== false
      ) {
        return false;
      }
      const weakMapControl = new NativeWeakMap<object, object>();
      const weakMapKey = {};
      const weakMapValue = { marker: 'kovo-fetch-response-plan' };
      if (
        apply<unknown>(nativeWeakMapSet, weakMapControl, [weakMapKey, weakMapValue]) !==
          weakMapControl ||
        apply<unknown>(nativeWeakMapHas, weakMapControl, [weakMapKey]) !== true ||
        apply<unknown>(nativeWeakMapHas, weakMapControl, [{}]) !== false ||
        apply<unknown>(nativeWeakMapGet, weakMapControl, [weakMapKey]) !== weakMapValue
      ) {
        return false;
      }
      let rejectedForeignWeakMapReceiver = false;
      try {
        apply(nativeWeakMapGet, {}, [weakMapKey]);
      } catch {
        rejectedForeignWeakMapReceiver = true;
      }
      if (!rejectedForeignWeakMapReceiver) return false;
      const mapControl = new NativeMap<unknown, object>();
      const mapKey = 'kovo-browser-map-control';
      const mapValue = { marker: 'kovo-browser-map-value' };
      if (
        apply<unknown>(nativeMapSet, mapControl, [mapKey, mapValue]) !== mapControl ||
        apply<unknown>(nativeMapGet, mapControl, [mapKey]) !== mapValue ||
        apply<boolean>(nativeMapHas, mapControl, [mapKey]) !== true ||
        apply<boolean>(nativeMapHas, mapControl, ['kovo-browser-map-negative']) !== false
      ) {
        return false;
      }
      let rejectedForeignMapReceiver = false;
      try {
        apply(nativeMapGet, {}, [mapKey]);
      } catch {
        rejectedForeignMapReceiver = true;
      }
      if (!rejectedForeignMapReceiver) return false;
      const abortControllerControl = new NativeAbortController();
      const abortSignalControl = apply<unknown>(abortControllerSignal, abortControllerControl, []);
      if (
        abortSignalControl === null ||
        typeof abortSignalControl !== 'object' ||
        apply<unknown>(abortSignalAborted, abortSignalControl, []) !== false
      ) {
        return false;
      }
      apply(abortControllerAbort, abortControllerControl, []);
      if (apply<unknown>(abortSignalAborted, abortSignalControl, []) !== true) return false;
      let rejectedForeignAbortReceiver = false;
      try {
        apply(abortControllerAbort, {}, []);
      } catch {
        rejectedForeignAbortReceiver = true;
      }
      if (!rejectedForeignAbortReceiver) return false;
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
      const decoderByteLength = apply<unknown>(uint8ArrayByteLength, decoderBytes, []);
      if (typeof decoderByteLength !== 'number') return false;
      const decoderCopy = new NativeUint8Array(decoderByteLength);
      apply(uint8ArraySet, decoderCopy, [decoderBytes, 0]);
      const decoderCopyByteLength = apply<unknown>(uint8ArrayByteLength, decoderCopy, []);
      if (
        decoderCopyByteLength !== decoderByteLength ||
        decoderCopy[0] !== 60 ||
        decoderCopy[decoderByteLength - 1] !== 62
      ) {
        return false;
      }
      const streamControl = new NativeReadableStream<Uint8Array>();
      if (apply<unknown>(readableStreamLocked, streamControl, []) !== false) return false;
      const readerControl = apply<unknown>(readableStreamGetReader, streamControl, []);
      if (
        readerControl === null ||
        typeof readerControl !== 'object' ||
        apply<unknown>(readableStreamLocked, streamControl, []) !== true
      ) {
        return false;
      }
      apply(readerReleaseLock, readerControl, []);
      if (apply<unknown>(readableStreamLocked, streamControl, []) !== false) return false;
      if (NativePageTransitionEvent) {
        if (!pageTransitionPersisted) return false;
        const persistedControl = new NativePageTransitionEvent('pageshow', { persisted: true });
        const ordinaryControl = new NativePageTransitionEvent('pageshow', { persisted: false });
        if (
          apply<unknown>(pageTransitionPersisted, persistedControl, []) !== true ||
          apply<unknown>(pageTransitionPersisted, ordinaryControl, []) !== false
        ) {
          return false;
        }
      }
      if (NativeDocument) {
        if (
          !NativeEvent ||
          !documentObject ||
          !documentQuerySelector ||
          !documentElement ||
          !eventTargetAddEventListener ||
          !eventTargetRemoveEventListener ||
          !eventTargetDispatchEvent ||
          !eventTypeGetter ||
          !eventTargetGetter ||
          !eventCancelableGetter ||
          !eventDefaultPreventedGetter ||
          !eventPreventDefault ||
          (NativeMouseEvent &&
            (!mouseEventRelatedTarget ||
              !mouseEventButton ||
              !mouseEventAltKey ||
              !mouseEventCtrlKey ||
              !mouseEventMetaKey ||
              !mouseEventShiftKey)) ||
          (NativeSubmitEvent && !submitEventSubmitter)
        ) {
          return false;
        }
        // SPEC §6.6/§8: prove that the exact real-document query and EventTarget controls used
        // for bfcache enrollment preserve platform receiver and add/remove/dispatch semantics.
        const queriedRoot = apply<unknown>(documentQuerySelector, documentObject, ['html']);
        const expectedRoot = apply<unknown>(documentElement, documentObject, []);
        if (queriedRoot === null || queriedRoot !== expectedRoot) return false;
        let rejectedForeignQueryReceiver = false;
        try {
          apply(documentQuerySelector, {}, ['html']);
        } catch {
          rejectedForeignQueryReceiver = true;
        }
        if (!rejectedForeignQueryReceiver) return false;

        const eventType = 'kovo-security-control:lifecycle-event-target';
        const eventTargetControl = documentObject;
        let eventCalls = 0;
        const eventListener = () => {
          eventCalls += 1;
        };
        apply(eventTargetAddEventListener, eventTargetControl, [eventType, eventListener]);
        let firstDispatchResult: unknown;
        try {
          firstDispatchResult = apply<unknown>(eventTargetDispatchEvent, eventTargetControl, [
            new NativeEvent(eventType),
          ]);
        } finally {
          apply(eventTargetRemoveEventListener, eventTargetControl, [eventType, eventListener]);
        }
        if (firstDispatchResult !== true || eventCalls !== 1) {
          return false;
        }
        if (
          apply<unknown>(eventTargetDispatchEvent, eventTargetControl, [
            new NativeEvent(eventType),
          ]) !== true ||
          eventCalls !== 1
        ) {
          return false;
        }
        let rejectedForeignEventReceiver = false;
        try {
          apply(eventTargetAddEventListener, {}, [eventType, eventListener]);
        } catch {
          rejectedForeignEventReceiver = true;
        }
        if (!rejectedForeignEventReceiver) return false;
        const eventFactControl = new NativeEvent('kovo-security-control:event-facts', {
          cancelable: true,
        });
        if (
          apply<unknown>(eventTypeGetter, eventFactControl, []) !==
            'kovo-security-control:event-facts' ||
          apply<unknown>(eventTargetGetter, eventFactControl, []) !== null ||
          apply<unknown>(eventCancelableGetter, eventFactControl, []) !== true ||
          apply<unknown>(eventDefaultPreventedGetter, eventFactControl, []) !== false
        ) {
          return false;
        }
        apply(eventPreventDefault, eventFactControl, []);
        if (apply<unknown>(eventDefaultPreventedGetter, eventFactControl, []) !== true)
          return false;
        if (NativeMouseEvent) {
          const mouseFactControl = new NativeMouseEvent('click', {
            altKey: true,
            button: 1,
            ctrlKey: true,
            metaKey: true,
            shiftKey: true,
          });
          if (
            apply<unknown>(mouseEventButton!, mouseFactControl, []) !== 1 ||
            apply<unknown>(mouseEventAltKey!, mouseFactControl, []) !== true ||
            apply<unknown>(mouseEventCtrlKey!, mouseFactControl, []) !== true ||
            apply<unknown>(mouseEventMetaKey!, mouseFactControl, []) !== true ||
            apply<unknown>(mouseEventShiftKey!, mouseFactControl, []) !== true
          ) {
            return false;
          }
        }
        if (NativeCustomEvent) {
          if (!customEventDetail) return false;
          const detailControl = { marker: 'kovo-security-control:custom-event-detail' };
          const customEventControl = new NativeCustomEvent('kovo-security-control:custom-event', {
            detail: detailControl,
          });
          if (apply<unknown>(customEventDetail, customEventControl, []) !== detailControl) {
            return false;
          }
          let rejectedForeignCustomEventReceiver = false;
          try {
            apply(customEventDetail, {}, []);
          } catch {
            rejectedForeignCustomEventReceiver = true;
          }
          if (!rejectedForeignCustomEventReceiver) return false;
        }
      }
      if (NativeMessageEvent) {
        if (!messageEventData) return false;
        const firstData = {
          body: '<kovo-done reason="security-control"></kovo-done>',
          changes: [],
          principal: 'kovo-message-control-a',
          type: 'kovo:mutation-response',
        };
        const secondData = { marker: 'kovo-message-control-b' };
        const firstEvent = new NativeMessageEvent('message', { data: firstData });
        const secondEvent = new NativeMessageEvent('message', { data: secondData });
        if (
          apply<unknown>(messageEventData, firstEvent, []) !== firstData ||
          apply<unknown>(messageEventData, secondEvent, []) !== secondData
        ) {
          return false;
        }
        let rejectedForeignReceiver = false;
        try {
          apply(messageEventData, {}, []);
        } catch {
          rejectedForeignReceiver = true;
        }
        if (!rejectedForeignReceiver) return false;
      }
      if (NativeDocument && NativeBroadcastChannel) {
        if (
          !broadcastChannelName ||
          !broadcastChannelPostMessage ||
          !broadcastChannelClose ||
          !broadcastChannelOnMessageSetter ||
          !broadcastChannelOnMessage ||
          !cryptoObject ||
          !cryptoRandomUuid ||
          !nativeSetTimeout ||
          !nativeClearTimeout ||
          !messageEventData
        ) {
          return false;
        }
        const firstUuid = apply<unknown>(cryptoRandomUuid, cryptoObject, []);
        const secondUuid = apply<unknown>(cryptoRandomUuid, cryptoObject, []);
        if (
          typeof firstUuid !== 'string' ||
          typeof secondUuid !== 'string' ||
          firstUuid.length < 16 ||
          secondUuid.length < 16 ||
          firstUuid === secondUuid
        ) {
          return false;
        }
        broadcastWitnessPrincipal = 'kovo-broadcast-witness:' + firstUuid;
        const channelName = 'kovo:mutation-response';
        const channel = new NativeBroadcastChannel(channelName);
        let actualName: unknown;
        try {
          actualName = apply<unknown>(broadcastChannelName, channel, []);
        } finally {
          apply(broadcastChannelClose, channel, []);
        }
        if (actualName !== channelName) return false;
        if (apply<unknown>(broadcastChannelOnMessage, channel, []) !== null) return false;
        let rejectedForeignReceiver = false;
        try {
          apply(broadcastChannelName, {}, []);
        } catch {
          rejectedForeignReceiver = true;
        }
        if (!rejectedForeignReceiver) return false;
        let rejectedForeignHandlerReceiver = false;
        try {
          apply(broadcastChannelOnMessage, {}, []);
        } catch {
          rejectedForeignHandlerReceiver = true;
        }
        if (!rejectedForeignHandlerReceiver) return false;
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
      if (NativeResponse) {
        if (
          !NativeHeaders ||
          !headersGet ||
          !responseBody ||
          !responseHeaders ||
          !responseOk ||
          !responseRedirected ||
          !responseStatus ||
          !responseUrl ||
          !responseText
        ) {
          return false;
        }
        const responseControl = new NativeResponse('kovo-response-control', {
          headers: { 'Kovo-Build': 'kovo-response-build' },
          status: 202,
        });
        const responsePlan = nativeFetchResponsePlan(responseControl);
        if (
          !responsePlan ||
          responsePlan.status !== 202 ||
          responsePlan.ok !== true ||
          responsePlan.redirected !== false ||
          responsePlan.url !== '' ||
          readFetchResponseHeader(responsePlan, 'Kovo-Build') !== 'kovo-response-build'
        ) {
          return false;
        }
        const textPromise = apply<unknown>(responseText, responseControl, []);
        if (textPromise === null || typeof textPromise !== 'object') return false;
        apply(nativePromiseThen, textPromise, [undefined, () => undefined]);
        let rejectedForeignResponseReceiver = false;
        try {
          apply(responseStatus, {}, []);
        } catch {
          rejectedForeignResponseReceiver = true;
        }
        if (!rejectedForeignResponseReceiver) return false;
      }
      if (NativeDocument && NativeElement && NativeNode && documentObject) {
        if (
          !NativeHTMLFormElement ||
          !NativeFormData ||
          !formDataGet ||
          !formDataSet ||
          !htmlFormSubmit ||
          !documentCreateElement ||
          !elementSetAttribute ||
          !elementGetAttribute ||
          !elementClosest ||
          !elementHasAttribute ||
          !elementMatches ||
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
          !nodeInsertBefore ||
          !nodeChildNodes ||
          !nodeContains ||
          !nodeIsConnected ||
          !nodeTextContent ||
          !nodeTextContentSetter ||
          !inputChecked ||
          !inputCheckedSetter ||
          !inputIndeterminate ||
          !inputIndeterminateSetter ||
          !inputValue ||
          !inputValueSetter ||
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
          !elementQuerySelectorAll ||
          (NativeDocument !== undefined && !documentQuerySelectorAll) ||
          (NativeDocumentFragment !== undefined && !fragmentQuerySelectorAll)
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
        const parserTemplateControl = apply<unknown>(documentCreateElement, documentObject, [
          'template',
        ]);
        const templateChildControl = apply<unknown>(documentCreateElement, documentObject, [
          'strong',
        ]);
        const formSubmitControl = apply<unknown>(documentCreateElement, documentObject, ['form']);
        const propertyControl = apply<unknown>(documentCreateElement, documentObject, ['input']);
        const textControl = apply<unknown>(documentCreateElement, documentObject, ['span']);
        const insertParentControl = apply<unknown>(documentCreateElement, documentObject, ['div']);
        const insertAnchorControl = apply<unknown>(documentCreateElement, documentObject, ['em']);
        const insertNodeControl = apply<unknown>(documentCreateElement, documentObject, ['u']);
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
          typeof templateControl !== 'object' ||
          parserTemplateControl === null ||
          typeof parserTemplateControl !== 'object' ||
          templateChildControl === null ||
          typeof templateChildControl !== 'object' ||
          formSubmitControl === null ||
          typeof formSubmitControl !== 'object' ||
          propertyControl === null ||
          typeof propertyControl !== 'object' ||
          textControl === null ||
          typeof textControl !== 'object' ||
          insertParentControl === null ||
          typeof insertParentControl !== 'object' ||
          insertAnchorControl === null ||
          typeof insertAnchorControl !== 'object' ||
          insertNodeControl === null ||
          typeof insertNodeControl !== 'object'
        ) {
          return false;
        }
        // C210 / SPEC §6.6/§9.2: prove the exact native fallback method accepts a real detached
        // form and rejects a forged receiver. Detached submission performs no navigation.
        apply(htmlFormSubmit, formSubmitControl, []);
        let rejectedForeignFormReceiver = false;
        try {
          apply(htmlFormSubmit, {}, []);
        } catch {
          rejectedForeignFormReceiver = true;
        }
        if (!rejectedForeignFormReceiver) return false;
        const formDataControl = new NativeFormData(formSubmitControl as HTMLFormElement);
        if (apply(formDataGet, formDataControl, ['kovo-missing-control']) !== null) return false;
        apply(formDataSet, formDataControl, ['Kovo-Idem', 'kovo-form-data-control']);
        if (apply(formDataGet, formDataControl, ['Kovo-Idem']) !== 'kovo-form-data-control') {
          return false;
        }
        let rejectedForeignFormDataReceiver = false;
        try {
          apply(formDataSet, {}, ['Kovo-Idem', 'kovo-form-data-control']);
        } catch {
          rejectedForeignFormDataReceiver = true;
        }
        if (!rejectedForeignFormDataReceiver) return false;
        apply(elementSetAttribute, snapshotControl, ['kovo-nav-segment', 'security-control']);
        apply(elementSetAttribute, nestedControl, ['kovo-nav-segment', 'nested-control']);
        apply(elementSetAttribute, nestedControl, ['kovo-fragment-target', 'security-live-target']);
        apply(elementSetAttribute, appendControl, ['data-kovo-commit', 'append']);
        apply(elementSetAttribute, prependControl, ['data-kovo-commit', 'prepend']);
        apply(elementSetAttribute, replacementControl, [
          'kovo-fragment-target',
          'security-live-target',
        ]);
        apply(elementSetAttribute, templateChildControl, ['data-kovo-template-control', 'yes']);
        apply(nodeTextContentSetter, textControl, ['kovo-text-content-control']);
        apply(inputCheckedSetter, propertyControl, [true]);
        apply(inputIndeterminateSetter, propertyControl, [true]);
        apply(inputValueSetter, propertyControl, ['kovo-property-control']);
        if (
          apply<unknown>(inputChecked, propertyControl, []) !== true ||
          apply<unknown>(inputIndeterminate, propertyControl, []) !== true ||
          apply<unknown>(inputValue, propertyControl, []) !== 'kovo-property-control'
        ) {
          return false;
        }
        apply(nodeAppendChild, snapshotControl, [nestedControl]);
        apply(nodeAppendChild, insertParentControl, [insertAnchorControl]);
        if (
          apply<unknown>(elementClosest, nestedControl, [
            '[kovo-nav-segment="security-control"]',
          ]) !== snapshotControl ||
          apply<unknown>(elementMatches, snapshotControl, [
            '[kovo-nav-segment="security-control"]',
          ]) !== true ||
          apply<unknown>(nodeInsertBefore, insertParentControl, [
            insertNodeControl,
            insertAnchorControl,
          ]) !== insertNodeControl ||
          apply<unknown>(elementOuterHtml, insertParentControl, []) !==
            '<div><u></u><em></em></div>'
        ) {
          return false;
        }
        const templateFragment = apply<unknown>(templateContent, templateControl, []);
        if (templateFragment === null || typeof templateFragment !== 'object') return false;
        // C186 / SPEC §6.6: the realm witness must not itself violate the default Trusted Types
        // CSP before Kovo's sole `kovo` policy exists. Build the detached semantic control with
        // captured non-HTML DOM primitives; production HTML parsing still requires a policy-
        // minted TrustedHTML value at the captured innerHTML setter below `createFragmentContent`.
        apply(nodeAppendChild, templateFragment, [templateChildControl]);
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
          apply<unknown>(nodeIsConnected, templateChild, []) !== false ||
          apply<unknown>(nodeTextContent, textControl, []) !== 'kovo-text-content-control'
        ) {
          return false;
        }
        if (createHTML) {
          // SPEC §4.8/§6.6: when the boot-owned Trusted Types mint is available, witness the exact
          // parser setter that template stamps and fragment commits will use. This catches a
          // selectively replaced pre-init innerHTML setter without violating a required-TT CSP.
          const parserWitness = '<mark data-kovo-parser-control="exact">kovo-parser-control</mark>';
          const parserHtml = apply<unknown>(createHTML, undefined, [parserWitness]);
          apply(elementInnerHtmlSetter, parserTemplateControl, [parserHtml]);
          const parserFragment = apply<unknown>(templateContent, parserTemplateControl, []);
          if (parserFragment === null || typeof parserFragment !== 'object') return false;
          const parserChildren = apply<unknown>(fragmentChildren, parserFragment, []);
          if (
            parserChildren === null ||
            typeof parserChildren !== 'object' ||
            apply<unknown>(htmlCollectionLength, parserChildren, []) !== 1
          ) {
            return false;
          }
          const parserChild = apply<unknown>(htmlCollectionItem, parserChildren, [0]);
          if (
            parserChild === null ||
            typeof parserChild !== 'object' ||
            apply<unknown>(elementTagName, parserChild, []) !== 'MARK' ||
            apply<unknown>(elementGetAttribute, parserChild, ['data-kovo-parser-control']) !==
              'exact' ||
            apply<unknown>(nodeTextContent, parserChild, []) !== 'kovo-parser-control'
          ) {
            return false;
          }
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
  if (NativeResponse) {
    responseControlsReady = validateResponseControls();
  } else {
    responseControlsVerified = true;
    responseControlsReady = (async () => undefined)();
  }
  observePromiseRejection(responseControlsReady);
  streamControlsReady = validateStreamControls();
  observePromiseRejection(streamControlsReady);
  if (NativeDocument && NativeBroadcastChannel) {
    broadcastControlsReady = validateBroadcastControls();
    observePromiseRejection(broadcastControlsReady);
  } else {
    broadcastControlsVerified = true;
  }

  return {
    acquireStreamReader,
    addLifecycleEventListener,
    appendDenseSecurityValue,
    appendElementChildren,
    cancelReadableStream,
    cancelStreamReader,
    call,
    charCode,
    cloneDomNode,
    cloneElement,
    closestElement,
    createHtmlElement,
    createSecurityMap,
    createMutationBroadcastChannel,
    createFragmentContent,
    createFormData,
    createTextDecoder,
    currentPathTarget,
    currentUrl,
    decodeComponent,
    decodeText,
    dispatchCustomEvent,
    fetchDocument,
    fetchWith,
    fetchWithOptionalSyncResult,
    fetchValue,
    getOwnSecurityPropertyDescriptor,
    getSecurityMapValue,
    getElementById,
    hardNavigate,
    hasReloadControl,
    hasElementAttribute,
    hasSecurityMapValue,
    islandAbortSignal,
    isPlatformElement,
    insertDomNode,
    elementContains,
    isHtmlContentType,
    isTrimmedAsciiEqual,
    indexOf,
    lower,
    matchesElement,
    navigateSameOrigin,
    parseHtmlDocument,
    parseUrl,
    preventDelegatedEventDefault,
    prependElementChildren,
    queryOne,
    queryAllElements,
    readAttribute,
    readCustomEventDetail,
    readDocumentActiveElement,
    readElementOuterHtml,
    readElementProperty,
    readElementTagName,
    readHeader,
    readPageTransitionPersisted,
    readFormDataValue,
    readDocumentField,
    readResponseField,
    readResponseText,
    readResponseTextOptionalSync,
    regExpExec,
    regExpTest,
    readStreamChunk,
    readNodeIsConnected,
    readNodeTextContent,
    removeLifecycleEventListener,
    removeElementAttribute,
    reload,
    removeElement,
    retireMutationBroadcastChannel,
    retireIslandSignal,
    replaceElement,
    replaceElementChildren,
    releaseStreamReader,
    safeSameOriginPath,
    setElementAttribute,
    setElementProperty,
    setFormDataValue,
    setSecurityMapValue,
    setNodeTextContent,
    slice,
    snapshotChildNodes,
    snapshotDelegatedEvent,
    snapshotElementAttributes,
    snapshotElementChildren,
    snapshotMutationBroadcastEnvelopeData,
    snapshotMutationBroadcastEnvelope,
    setMutationBroadcastMessageHandler,
    submitForm,
    postMutationBroadcastEnvelope,
    observePromiseRejection,
    trim,
    upper,
  };
}
