/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Stretch Vertical icon (Lucide). https://lucide.dev/icons/stretch-vertical */
export function StretchVertical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="20" x="4" y="2" rx="2"></rect>
      <rect width="6" height="20" x="14" y="2" rx="2"></rect>
    </svg>
  );
}
