/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Corner Left Down icon (Lucide). https://lucide.dev/icons/corner-left-down */
export function CornerLeftDown(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m14 15-5 5-5-5"></path>
      <path d="M20 4h-7a4 4 0 0 0-4 4v12"></path>
    </svg>
  );
}
