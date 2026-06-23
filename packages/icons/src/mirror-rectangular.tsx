/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Mirror Rectangular icon (Lucide). https://lucide.dev/icons/mirror-rectangular */
export function MirrorRectangular(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 6 8 9"></path>
      <path d="m16 7-8 8"></path>
      <rect x="4" y="2" width="16" height="20" rx="2"></rect>
    </svg>
  );
}
