export function mark(): void {
  const output = document.querySelector('[data-document-result]');
  if (output) output.textContent = 'handler ran';
}
