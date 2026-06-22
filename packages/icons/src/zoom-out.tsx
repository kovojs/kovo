/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zoom Out icon (Lucide). https://lucide.dev/icons/zoom-out */
export function ZoomOut(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" x2="16.65" y1="21" y2="16.65"></line>
      <line x1="8" x2="14" y1="11" y2="11"></line>
    </svg>
  );
}
