export interface PageAssertion {
  fragment(target: string): string;
  html: string;
}

export function createPageAssertion(html: string): PageAssertion {
  return {
    fragment(target: string): string {
      const explicitFragment = explicitFragmentHtml(html, target);
      if (explicitFragment !== undefined) return explicitFragment;

      const stampedElement = findFragmentTargetElement(html, target);
      if (!stampedElement) return '';

      const end = matchingElementEnd(html, stampedElement);
      if (end === undefined) return '';

      return html.slice(stampedElement.index, end);
    },
    html,
  };
}

function explicitFragmentHtml(html: string, target: string): string | undefined {
  const fragmentStart = findOpeningElement(
    html,
    (element) =>
      element.tag === 'fw-fragment' && readHtmlAttribute(element.attrs, 'target') === target,
  );
  if (!fragmentStart) return undefined;

  const end = matchingElementEnd(html, fragmentStart);
  if (end === undefined) return undefined;

  return html.slice(fragmentStart.end, end - '</fw-fragment>'.length);
}

interface OpeningElement {
  attrs: string;
  end: number;
  index: number;
  tag: string;
}

function findFragmentTargetElement(html: string, target: string): OpeningElement | undefined {
  return findOpeningElement(html, (element) => {
    const fragmentTarget = readHtmlAttribute(element.attrs, 'fw-fragment-target');
    const id = readHtmlAttribute(element.attrs, 'id');

    // SPEC.md §9.1: fragment chunks address the runtime target by name; the
    // browser runtime resolves that name with id / fw-fragment-target only.
    return fragmentTarget === target || id === target;
  });
}

function findOpeningElement(
  html: string,
  predicate: (element: OpeningElement) => boolean,
): OpeningElement | undefined {
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) return undefined;

    const element = readOpeningElement(html, start);
    if (element) {
      if (predicate(element)) return element;
      offset = element.end;
    } else {
      offset = start + 1;
    }
  }

  return undefined;
}

function readOpeningElement(html: string, start: number): OpeningElement | undefined {
  const head = /^<(?<tag>[a-z][a-z0-9-]*)\b/i.exec(html.slice(start));
  if (!head?.groups?.tag) return undefined;

  const close = tagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    attrs: html.slice(start + head[0].length, close),
    end: close + 1,
    index: start,
    tag: head.groups.tag.toLowerCase(),
  };
}

function tagClose(html: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return index;
  }

  return undefined;
}

function matchingElementEnd(html: string, element: OpeningElement): number | undefined {
  if (/\/\s*$/.test(element.attrs)) return element.end;

  let offset = element.end;
  let depth = 1;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) return undefined;

    const closing = readClosingElement(html, start);
    if (closing) {
      if (closing.tag === element.tag) {
        depth -= 1;
        if (depth === 0) return closing.end;
      }
      offset = closing.end;
      continue;
    }

    const opening = readOpeningElement(html, start);
    if (opening) {
      if (opening.tag === element.tag && !/\/\s*$/.test(opening.attrs)) {
        depth += 1;
      }
      offset = opening.end;
      continue;
    }

    offset = start + 1;
  }

  return undefined;
}

function readClosingElement(html: string, start: number): { end: number; tag: string } | undefined {
  const head = /^<\/(?<tag>[a-z][a-z0-9-]*)\b/i.exec(html.slice(start));
  if (!head?.groups?.tag) return undefined;

  const close = tagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    end: close + 1,
    tag: head.groups.tag.toLowerCase(),
  };
}

function readHtmlAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s"'=<>\`]+)))?(?=\\s|$|/)`,
    'i',
  );
  const match = pattern.exec(attrs);
  if (!match) return null;

  return match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
