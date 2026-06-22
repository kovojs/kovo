/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Left Dashed icon (Lucide). https://lucide.dev/icons/panel-left-dashed */
export function PanelLeftDashed(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M9 14v1"></path>
      <path d="M9 19v2"></path>
      <path d="M9 3v2"></path>
      <path d="M9 9v1"></path>
    </svg>
  );
}
