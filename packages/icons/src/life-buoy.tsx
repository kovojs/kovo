/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Life Buoy icon (Lucide). https://lucide.dev/icons/life-buoy */
export function LifeBuoy(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m4.93 4.93 4.24 4.24"></path>
      <path d="m14.83 9.17 4.24-4.24"></path>
      <path d="m14.83 14.83 4.24 4.24"></path>
      <path d="m9.17 14.83-4.24 4.24"></path>
      <circle cx="12" cy="12" r="4"></circle>
    </svg>
  );
}
