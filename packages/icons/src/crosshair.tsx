/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Crosshair icon (Lucide). https://lucide.dev/icons/crosshair */
export function Crosshair(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="22" x2="18" y1="12" y2="12"></line>
      <line x1="6" x2="2" y1="12" y2="12"></line>
      <line x1="12" x2="12" y1="6" y2="2"></line>
      <line x1="12" x2="12" y1="22" y2="18"></line>
    </svg>
  );
}
