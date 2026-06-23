/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Corner Down Left icon (Lucide). https://lucide.dev/icons/corner-down-left */
export function CornerDownLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
      <path d="m9 10-5 5 5 5"></path>
    </svg>
  );
}
