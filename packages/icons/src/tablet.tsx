/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tablet icon (Lucide). https://lucide.dev/icons/tablet */
export function Tablet(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2"></rect>
      <line x1="12" x2="12.01" y1="18" y2="18"></line>
    </svg>
  );
}
