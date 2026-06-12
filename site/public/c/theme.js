/**
 * Theme toggle island. An ordinary Jiso handler module (SPEC §4.4, §7 L1):
 * nothing here loads until the first click. The default is the system theme —
 * the inline head script applies it before first paint; this module only
 * records an explicit choice.
 */

export function toggle(event) {
  event.preventDefault?.();
  const root = document.documentElement;
  const dark = !root.classList.contains('dark');
  root.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    /* private mode: the choice just doesn't persist */
  }
}
