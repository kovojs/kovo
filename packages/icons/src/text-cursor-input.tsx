/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Text Cursor Input icon (Lucide). https://lucide.dev/icons/text-cursor-input */
export function TextCursorInput(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6"></path>
      <path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7"></path>
      <path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1"></path>
      <path d="M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1"></path>
      <path d="M9 6v12"></path>
    </svg>
  );
}
