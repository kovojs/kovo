export const inlineJisoLoaderInstallerReadableSource = String.raw`
/* SPEC.md §4.4: this is the always-loaded bootstrap source. */
function installInlineJisoLoader(importModule) {
  const events = ['click', 'submit', 'input', 'change'];
  const doc = document;
  let idemCounter = 0;
  const createInlineIdem = () =>
    crypto.randomUUID?.() ??
    'idem_' + Date.now().toString(36) + '_' + (idemCounter += 1).toString(36);
  const readStateHost = (element) => element.closest?.('[fw-state]') ?? element;
  const readState = (element) => {
    try {
      return JSON.parse(readStateHost(element)?.getAttribute('fw-state') ?? '{}');
    } catch {
      return {};
    }
  };
  const readDeps = (value) =>
    (value ?? '')
      .split(/[\s,]+/)
      .map((dep) => dep.trim())
      .filter(Boolean);
  const readTargets = () => [
    ...new Set(
      [...doc.querySelectorAll('[fw-deps]')]
        .map((element) => {
          const deps = readDeps(element.getAttribute('fw-deps'));
          const target = element.getAttribute('fw-fragment-target') ?? element.id;
          return target && (deps.length > 0 ? target + '=' + deps.join(' ') : target);
        })
        .filter(Boolean)
    )
  ];
  const findFragmentTarget = (target) =>
    doc.getElementById(target) ?? doc.querySelector('[fw-fragment-target="' + target + '"]');
  const applyFragment = (fragment) => {
    const target = fragment.getAttribute('target');
    const element = target && findFragmentTarget(target);
    if (!element) return;
    if (fragment.getAttribute('mode') === 'append') {
      element.insertAdjacentHTML('beforeend', fragment.innerHTML);
    } else {
      element.innerHTML = fragment.innerHTML;
    }
  };
  const applyResponseBody = (body) => {
    const parsed = new DOMParser().parseFromString(body, 'text/html');
    parsed.querySelectorAll('fw-query').forEach((query) => {
      dispatchEvent(
        new CustomEvent('jiso:query', {
          detail: {
            body: query.textContent,
            key: query.getAttribute('key') ?? undefined,
            name: query.getAttribute('name'),
          },
        }),
      );
    });
    parsed.querySelectorAll('fw-fragment').forEach(applyFragment);
  };
  const fallbackSubmit = (form) => {
    if (typeof form.submit === 'function') {
      form.submit();
      return;
    }
    form.setAttribute?.('data-error-code', 'NETWORK_ERROR');
    form.setAttribute?.('fw-error', '');
  };
  const submitEnhancedForm = (event, form) => {
    event.preventDefault();
    fetch(form.action, {
      body: new FormData(form),
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': createInlineIdem(),
        'FW-Targets': readTargets().join('; '),
      },
      keepalive: true,
      method: (form.method || 'post').toUpperCase(),
    })
      .then((response) => response.text())
      .then(applyResponseBody)
      .catch(() => fallbackSubmit(form));
  };
  const readParamTypes = (element) =>
    (element.getAttribute('fw-param-types') || '').split(/[\s,]+/).reduce((types, entry) => {
      const [name, type] = entry.split(':');
      if (name) types[name] = type;
      return types;
    }, {},);
  const dispatch = async (event) => {
    if (event.type === 'submit') {
      const form = event.target?.closest?.('form[enhance],form[data-enhance],form[data-mutation]',);
      if (form) {
        submitEnhancedForm(event, form);
        return;
      }
    }
    const element = event.target?.closest?.('[on\\:' + event.type + ']');
    const refs = element?.getAttribute('on:' + event.type);
    if (!element || !refs) return;
    const params = {};
    const paramTypes = readParamTypes(element);
    const state = readState(element);
    const stateHost = readStateHost(element);
    const context = { params, state, signal: new AbortController().signal };
    for (const attribute of element.attributes || []) {
      if (!attribute.name.startsWith('data-p-')) continue;
      const name = attribute.name
        .slice('data-p-'.length)
        .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
      const type = paramTypes[name];
      const value = attribute.value;
      params[name] = type === 'number' ? Number(value) : type === 'boolean' ? value === 'true' : value;
    }
    for (const ref of refs.split(/\s+/).filter(Boolean)) {
      const hashIndex = ref.lastIndexOf('#');
      if (hashIndex <= 0 || hashIndex === ref.length - 1) throw Error('Invalid handler reference: ' + ref);
      const mod = await importModule(ref.slice(0, hashIndex));
      const fn = mod[ref.slice(hashIndex + 1)];
      if (typeof fn !== 'function') throw Error('Handler export not found: ' + ref);
      await fn(event, context);
    }
    stateHost?.setAttribute?.('fw-state', JSON.stringify(state));
  };
  const trigger = (type, target) => {
    void dispatch({ target, type });
  };
  for (const event of events) addEventListener(event, dispatch, { capture: true });
  doc.querySelectorAll('[on\\:load]').forEach((element) => trigger('load', element));
  doc
    .querySelectorAll('[on\\:idle]')
    .forEach((element) => (globalThis.requestIdleCallback || setTimeout)(() => trigger('idle', element)),);
  if (globalThis.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        trigger('visible', entry.target);
      }),
    );
    doc.querySelectorAll('[on\\:visible]').forEach((element) => observer.observe(element));
  }
}
`;

export function buildInlineJisoLoaderInstallerSource(
  source = inlineJisoLoaderInstallerReadableSource,
): string {
  return minifyInlineJavaScriptSource(source);
}

function minifyInlineJavaScriptSource(source: string): string {
  let output = '';
  let index = 0;
  let previousToken = '';

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (isWhitespace(char)) {
      const nextToken = readNextTokenStart(source, index + 1);
      if (needsSeparator(previousToken, nextToken)) {
        output += ' ';
        previousToken = ' ';
      }
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      const end = skipLineComment(source, index + 2);
      const nextToken = readNextTokenStart(source, end);
      if (needsSeparator(previousToken, nextToken)) {
        output += ' ';
        previousToken = ' ';
      }
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = skipBlockComment(source, index + 2);
      const nextToken = readNextTokenStart(source, end);
      if (needsSeparator(previousToken, nextToken)) {
        output += ' ';
        previousToken = ' ';
      }
      index = end;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const literal = readQuotedLiteral(source, index, char);
      output += literal.value;
      previousToken = literal.value.at(-1) ?? previousToken;
      index = literal.end;
      continue;
    }

    if (char === '/' && startsRegexLiteral(previousToken)) {
      const literal = readRegexLiteral(source, index);
      output += literal.value;
      previousToken = literal.value.at(-1) ?? previousToken;
      index = literal.end;
      continue;
    }

    if (isIdentifierStart(char)) {
      const identifier = readIdentifier(source, index);
      output += identifier.value;
      previousToken = identifier.value;
      index = identifier.end;
      continue;
    }

    output += char;
    previousToken = char;
    index += 1;
  }

  return output.trim();
}

function readNextTokenStart(source: string, start: number): string {
  let index = start;

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      index = skipLineComment(source, index + 2);
      continue;
    }

    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index + 2);
      continue;
    }

    return char;
  }

  return '';
}

function readQuotedLiteral(
  source: string,
  start: number,
  quote: '"' | "'" | '`',
): { value: string; end: number } {
  let index = start + 1;
  let escaped = false;

  while (index < source.length) {
    const char = source[index]!;
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return { value: source.slice(start, index + 1), end: index + 1 };
    }
    index += 1;
  }

  throw new Error('Unterminated inline loader string literal.');
}

function readRegexLiteral(source: string, start: number): { value: string; end: number } {
  let index = start + 1;
  let escaped = false;
  let inCharacterClass = false;

  while (index < source.length) {
    const char = source[index]!;
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '[') {
      inCharacterClass = true;
    } else if (char === ']') {
      inCharacterClass = false;
    } else if (char === '/' && !inCharacterClass) {
      index += 1;
      while (/[a-z]/i.test(source[index] ?? '')) index += 1;
      return { value: source.slice(start, index), end: index };
    }
    index += 1;
  }

  throw new Error('Unterminated inline loader regex literal.');
}

function readIdentifier(source: string, start: number): { value: string; end: number } {
  let index = start + 1;

  while (isIdentifierPart(source[index] ?? '')) index += 1;

  return { value: source.slice(start, index), end: index };
}

function skipLineComment(source: string, start: number): number {
  const lineEnd = source.indexOf('\n', start);
  return lineEnd === -1 ? source.length : lineEnd + 1;
}

function skipBlockComment(source: string, start: number): number {
  const commentEnd = source.indexOf('*/', start);
  return commentEnd === -1 ? source.length : commentEnd + 2;
}

function startsRegexLiteral(previousToken: string): boolean {
  return (
    previousToken === '' ||
    '([{=,:?!&|;>'.includes(previousToken) ||
    regexPrefixKeywords.has(previousToken)
  );
}

function needsSeparator(previousToken: string, nextToken: string): boolean {
  if (!previousToken || !nextToken) return false;
  if (isIdentifierPart(previousToken) && isIdentifierPart(nextToken)) return true;
  if ((previousToken === '+' || previousToken === '-') && previousToken === nextToken) return true;
  return previousToken === '/' && nextToken === '/';
}

const regexPrefixKeywords = new Set([
  'case',
  'delete',
  'else',
  'in',
  'instanceof',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function isIdentifierStart(char: string): boolean {
  return /[$A-Z_a-z]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[$\w]/.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}
