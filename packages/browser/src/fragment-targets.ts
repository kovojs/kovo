/**
 * A DOM root the runtime resolves fragment targets against: a `ParentNode` with
 * an optional `getElementById` (SPEC §9.1). `Document` and element subtrees both
 * satisfy it; `createBrowserKovoRoot` wraps one to build a `BrowserKovoRoot`.
 */
export interface FragmentTargetRoot extends ParentNode {
  getElementById?(id: string): Element | null;
}

export function findFragmentTargetElement(
  root: FragmentTargetRoot,
  target: string,
): Element | null {
  // SPEC.md §9.1: fragment targets are live DOM targets. Apply lookup uses the
  // same identity precedence as Kovo-Targets collection: explicit fragment
  // target, then DOM id, then component stamp.
  return (
    findRootOrDescendant(root, `[kovo-fragment-target="${escapeCssString(target)}"]`) ??
    root.getElementById?.(target) ??
    findRootOrDescendant(root, `[id="${escapeCssString(target)}"]`) ??
    findRootOrDescendant(root, `[kovo-c="${escapeCssString(target)}"]`) ??
    findRootOrDescendant(root, `kovo-defer[target="${escapeCssString(target)}"]`)
  );
}

function findRootOrDescendant(root: FragmentTargetRoot, selector: string): Element | null {
  const maybeElement = root as Element & { matches?: (selector: string) => boolean };
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
