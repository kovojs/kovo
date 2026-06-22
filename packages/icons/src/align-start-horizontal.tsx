/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Align Start Horizontal icon (Lucide). https://lucide.dev/icons/align-start-horizontal */
export function AlignStartHorizontal(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="16" x="4" y="6" rx="2"></rect>
      <rect width="6" height="9" x="14" y="6" rx="2"></rect>
      <path d="M22 2H2"></path>
    </svg>
  );
}
