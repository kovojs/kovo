/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Right Close icon (Lucide). https://lucide.dev/icons/panel-right-close */
export function PanelRightClose(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M15 3v18"></path>
      <path d="m8 9 3 3-3 3"></path>
    </svg>
  );
}
