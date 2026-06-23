/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Corner Right Down icon (Lucide). https://lucide.dev/icons/corner-right-down */
export function CornerRightDown(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10 15 5 5 5-5"></path>
      <path d="M4 4h7a4 4 0 0 1 4 4v12"></path>
    </svg>
  );
}
