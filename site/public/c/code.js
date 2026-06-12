/**
 * Copy-to-clipboard island for code windows (SPEC §4.4, §7 L1): loads on the
 * first click of any Copy button, never before.
 */

export async function copy(event) {
  const button = event.target.closest('button.code-copy');
  const frame = button?.closest('.code-window');
  const code = frame?.querySelector('pre')?.textContent;
  if (!button || !code) return;

  try {
    await navigator.clipboard.writeText(code);
  } catch {
    return; // clipboard unavailable (insecure context): leave the button alone
  }

  button.dataset.copied = '';
  button.textContent = 'Copied';
  setTimeout(() => {
    delete button.dataset.copied;
    button.textContent = 'Copy';
  }, 1600);
}
