/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Stretch Horizontal icon (Lucide). https://lucide.dev/icons/stretch-horizontal */
export function StretchHorizontal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="6" x="2" y="4" rx="2"></rect>
      <rect width="20" height="6" x="2" y="14" rx="2"></rect>
    </svg>
  );
}
