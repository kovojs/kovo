/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Grid 3x2 icon (Lucide). https://lucide.dev/icons/grid-3x2 */
export function Grid3x2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 3v18"></path>
      <path d="M3 12h18"></path>
      <path d="M9 3v18"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
