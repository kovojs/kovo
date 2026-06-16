export interface FragmentTargetRoot extends ParentNode {
  getElementById?(id: string): Element | null;
}

export function findFragmentTargetElement(
  root: FragmentTargetRoot,
  target: string,
): Element | null {
  // SPEC.md §9.1: fragment targets are live DOM targets. Component stamps remain
  // the primary runtime identity, with id/kovo-fragment-target matching the
  // Kovo-Targets collection and inline-loader apply path.
  return (
    findRootOrDescendant(root, `[kovo-c="${escapeCssString(target)}"]`) ??
    root.getElementById?.(target) ??
    findRootOrDescendant(root, `[id="${escapeCssString(target)}"]`) ??
    findRootOrDescendant(root, `[kovo-fragment-target="${escapeCssString(target)}"]`)
  );
}

function findRootOrDescendant(root: FragmentTargetRoot, selector: string): Element | null {
  const maybeElement = root as Element & { matches?: (selector: string) => boolean };
  if (typeof maybeElement.matches === 'function' && maybeElement.matches(selector)) {
    return maybeElement;
  }

  return root.querySelector(selector);
}

function escapeCssString(value: string): string {
  return value.replace(/[\n\r\f"\\]/g, (char) => {
    if (char === '\n') return '\\a ';
    if (char === '\r') return '\\d ';
    if (char === '\f') return '\\c ';
    return `\\${char}`;
  });
}
