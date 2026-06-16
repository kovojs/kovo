export function mark(): void {
  const output = document.querySelector('[data-template-result]');
  if (output) output.textContent = 'handler ran';
}
