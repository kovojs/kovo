/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Align End Vertical icon (Lucide). https://lucide.dev/icons/align-end-vertical */
export function AlignEndVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="16" height="6" x="2" y="4" rx="2"></rect>
      <rect width="9" height="6" x="9" y="14" rx="2"></rect>
      <path d="M22 22V2"></path>
    </svg>
  );
}
