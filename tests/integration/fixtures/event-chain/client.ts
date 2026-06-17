export async function author(event: Event): Promise<void> {
  event.preventDefault();
  await Promise.resolve();
  append('author:prevented');
}

export function primitive(event: Event): void {
  append(event.defaultPrevented ? 'primitive:saw-prevented' : 'primitive:active');
}

function append(value: string): void {
  const output = document.querySelector('[data-order]');
  if (!output) return;
  output.textContent = output.textContent === 'idle' ? value : `${output.textContent},${value}`;
}
