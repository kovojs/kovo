/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Bottom Dashed icon (Lucide). https://lucide.dev/icons/panel-bottom-dashed */
export function PanelBottomDashed(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M14 15h1"></path>
      <path d="M19 15h2"></path>
      <path d="M3 15h2"></path>
      <path d="M9 15h1"></path>
    </svg>
  );
}
