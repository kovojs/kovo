import type { FragmentChunk } from './wire-response-scanner.js';

export interface ResponseFragmentApplyOptions<Target> {
  appendFragment(target: Target, html: string): void;
  findFragmentTarget(target: string): Target | null | undefined;
  replaceFragment(target: Target, html: string): void;
}

export interface HtmlResponseFragmentApplyTarget {
  innerHTML: string;
  insertAdjacentHTML(position: 'beforeend', html: string): void;
}

export function applyResponseFragment<Target>(
  fragment: FragmentChunk,
  options: ResponseFragmentApplyOptions<Target>,
): boolean {
  const element = options.findFragmentTarget(fragment.target);
  if (!element) return false;

  if (fragment.mode === 'append') {
    options.appendFragment(element, fragment.html);
  } else {
    options.replaceFragment(element, fragment.html);
  }
  return true;
}

export function applyResponseFragments<Target>(
  fragments: readonly FragmentChunk[],
  options: ResponseFragmentApplyOptions<Target>,
): string[] {
  // SPEC.md §9.1: decoded fw-fragment chunks report the same applied target
  // list whether the caller is modular DOM morph or the generated inline loader.
  const applied: string[] = [];

  for (const fragment of fragments) {
    if (applyResponseFragment(fragment, options)) applied.push(fragment.target);
  }

  return applied;
}

export function applyHtmlResponseFragments(
  fragments: readonly FragmentChunk[],
  findFragmentTarget: (target: string) => HtmlResponseFragmentApplyTarget | null | undefined,
): string[] {
  // SPEC.md §9.1: inline loader HTML patching uses the same decoded fragment
  // target filtering and applied-target reporting as modular DOM morph apply.
  return applyResponseFragments(fragments, {
    appendFragment: appendHtmlResponseFragment,
    findFragmentTarget,
    replaceFragment: replaceHtmlResponseFragment,
  });
}

function appendHtmlResponseFragment(element: HtmlResponseFragmentApplyTarget, html: string): void {
  element.insertAdjacentHTML('beforeend', html);
}

function replaceHtmlResponseFragment(element: HtmlResponseFragmentApplyTarget, html: string): void {
  element.innerHTML = html;
}
