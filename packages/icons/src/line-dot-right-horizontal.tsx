/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Line Dot Right Horizontal icon (Lucide). https://lucide.dev/icons/line-dot-right-horizontal */
export function LineDotRightHorizontal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M 3 12 L 15 12"></path>
      <circle cx="18" cy="12" r="3"></circle>
    </svg>
  );
}
