export function renderMarkdownStream(
  target: Element,
  source: string,
  _options: { signal?: AbortSignal },
): void {
  const features = [
    source.includes('|') ? 'table' : '',
    source.includes('```') ? 'code' : '',
    source.includes('![') ? 'image' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const rendered = new Set(
    `${document.body.getAttribute('data-rendered-markdown') ?? ''} ${features || 'plain'}`
      .split(/\s+/)
      .filter(Boolean),
  );
  const value = [...rendered].join(' ');
  target.setAttribute('data-rendered-markdown', value);
  document.body.setAttribute('data-rendered-markdown', value);
}
