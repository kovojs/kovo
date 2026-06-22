/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clipboard Minus icon (Lucide). https://lucide.dev/icons/clipboard-minus */
export function ClipboardMinus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
      <path d="M9 14h6"></path>
    </svg>
  );
}
