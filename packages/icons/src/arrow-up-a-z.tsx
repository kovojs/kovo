/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Up A Z icon (Lucide). https://lucide.dev/icons/arrow-up-a-z */
export function ArrowUpAZ(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 8 4-4 4 4"></path>
      <path d="M7 4v16"></path>
      <path d="M20 8h-5"></path>
      <path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"></path>
      <path d="M15 14h5l-5 6h5"></path>
    </svg>
  );
}
