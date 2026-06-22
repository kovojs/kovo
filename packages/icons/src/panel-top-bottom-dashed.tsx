/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Top Bottom Dashed icon (Lucide). https://lucide.dev/icons/panel-top-bottom-dashed */
export function PanelTopBottomDashed(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 15h1"></path>
      <path d="M14 9h1"></path>
      <path d="M19 15h2"></path>
      <path d="M19 9h2"></path>
      <path d="M3 15h2"></path>
      <path d="M3 9h2"></path>
      <path d="M9 15h1"></path>
      <path d="M9 9h1"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
