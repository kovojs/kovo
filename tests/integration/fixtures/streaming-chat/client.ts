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
  target.setAttribute('data-rendered-markdown', features || 'plain');
  document.body.setAttribute('data-rendered-markdown', features || 'plain');
}
