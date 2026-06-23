/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Corner Up Right icon (Lucide). https://lucide.dev/icons/corner-up-right */
export function CornerUpRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 14 5-5-5-5"></path>
      <path d="M4 20v-7a4 4 0 0 1 4-4h12"></path>
    </svg>
  );
}
