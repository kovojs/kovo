/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Grid 3x3 icon (Lucide). https://lucide.dev/icons/grid-3x3 */
export function Grid3x3(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 9h18"></path>
      <path d="M3 15h18"></path>
      <path d="M9 3v18"></path>
      <path d="M15 3v18"></path>
    </svg>
  );
}
