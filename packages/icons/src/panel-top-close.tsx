/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Top Close icon (Lucide). https://lucide.dev/icons/panel-top-close */
export function PanelTopClose(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 9h18"></path>
      <path d="m9 16 3-3 3 3"></path>
    </svg>
  );
}
