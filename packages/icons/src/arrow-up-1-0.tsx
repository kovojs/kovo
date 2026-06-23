/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Up 1 0 icon (Lucide). https://lucide.dev/icons/arrow-up-1-0 */
export function ArrowUp10(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 8 4-4 4 4"></path>
      <path d="M7 4v16"></path>
      <path d="M17 10V4h-2"></path>
      <path d="M15 10h4"></path>
      <rect x="15" y="14" width="4" height="6" ry="2"></rect>
    </svg>
  );
}
