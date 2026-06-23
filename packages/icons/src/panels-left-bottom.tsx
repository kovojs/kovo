/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Panels Left Bottom icon (Lucide). https://lucide.dev/icons/panels-left-bottom */
export function PanelsLeftBottom(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M9 3v18"></path>
      <path d="M9 15h12"></path>
    </svg>
  );
}
