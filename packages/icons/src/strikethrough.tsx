/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Strikethrough icon (Lucide). https://lucide.dev/icons/strikethrough */
export function Strikethrough(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 4H9a3 3 0 0 0-2.83 4"></path>
      <path d="M14 12a4 4 0 0 1 0 8H6"></path>
      <line x1="4" x2="20" y1="12" y2="12"></line>
    </svg>
  );
}
