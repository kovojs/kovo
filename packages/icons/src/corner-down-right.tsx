/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Corner Down Right icon (Lucide). https://lucide.dev/icons/corner-down-right */
export function CornerDownRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 10 5 5-5 5"></path>
      <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
    </svg>
  );
}
