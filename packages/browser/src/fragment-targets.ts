/**
 * A DOM root the runtime resolves fragment targets against: a `ParentNode` with
 * an optional `getElementById` (SPEC §9.1). `Document` and element subtrees both
 * satisfy it; `createBrowserKovoRoot` wraps one to build a `BrowserKovoRoot`.
 */
export interface FragmentTargetRoot extends ParentNode {
  getElementById?(id: string): Element | null;
}

/** @internal Boot-witnessed DOM controls for security-bearing fragment routing (SPEC §6.6/§9.1). */
export interface FragmentTargetSecurityControls {
  getElementById(root: unknown, id: string): Element | undefined;
  matchesElement(element: object, selector: string): boolean;
  queryOne(root: unknown, selector: string): Element | null;
}

export function findFragmentTargetElement(
  root: FragmentTargetRoot,
  target: string,
  security?: FragmentTargetSecurityControls,
): Element | null {
  // SPEC.md §9.1: fragment targets are live DOM targets. Apply lookup uses the
  // same identity precedence as Kovo-Targets collection: explicit fragment
  // target, then DOM id, then component stamp.
  return (
    findRootOrDescendant(root, `[kovo-fragment-target="${escapeCssString(target)}"]`, security) ??
    (security ? security.getElementById(root, target) : root.getElementById?.(target)) ??
    findRootOrDescendant(root, `[id="${escapeCssString(target)}"]`, security) ??
    findRootOrDescendant(root, `[kovo-c="${escapeCssString(target)}"]`, security) ??
    findRootOrDescendant(root, `kovo-defer[target="${escapeCssString(target)}"]`, security)
  );
}

function findRootOrDescendant(
  root: FragmentTargetRoot,
  selector: string,
  security?: FragmentTargetSecurityControls,
): Element | null {
  const maybeElement = root as Element & { matches?: (selector: string) => boolean };
  if (security) {
    return (
      (security.matchesElement(maybeElement, selector) ? maybeElement : null) ??
      security.queryOne(root, selector)
    );
  }
  if (typeof maybeElement.matches === 'function' && maybeElement.matches(selector)) {
    return maybeElement;
  }

  return root.querySelector(selector);
}

export function escapeCssString(value: string): string {
  // SPEC §6.6/§9.1: this helper protects a selector/output routing decision, so
  // do not dispatch through app-mutable String.prototype methods after import.
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\n') escaped += '\\a ';
    else if (char === '\r') escaped += '\\d ';
    else if (char === '\f') escaped += '\\c ';
    else if (char === '"' || char === '\\') escaped += '\\' + char;
    else if (char !== undefined) escaped += char;
  }
  return escaped;
}
