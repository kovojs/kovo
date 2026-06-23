/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Zoom In icon (Lucide). https://lucide.dev/icons/zoom-in */
export function ZoomIn(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" x2="16.65" y1="21" y2="16.65"></line>
      <line x1="11" x2="11" y1="8" y2="14"></line>
      <line x1="8" x2="14" y1="11" y2="11"></line>
    </svg>
  );
}
