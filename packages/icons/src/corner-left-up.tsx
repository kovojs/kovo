/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Corner Left Up icon (Lucide). https://lucide.dev/icons/corner-left-up */
export function CornerLeftUp(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 9 9 4 4 9"></path>
      <path d="M20 20h-7a4 4 0 0 1-4-4V4"></path>
    </svg>
  );
}
