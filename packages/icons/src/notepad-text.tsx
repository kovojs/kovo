/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Notepad Text icon (Lucide). https://lucide.dev/icons/notepad-text */
export function NotepadText(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 2v4"></path>
      <path d="M12 2v4"></path>
      <path d="M16 2v4"></path>
      <rect width="16" height="18" x="4" y="4" rx="2"></rect>
      <path d="M8 10h6"></path>
      <path d="M8 14h8"></path>
      <path d="M8 18h5"></path>
    </svg>
  );
}
