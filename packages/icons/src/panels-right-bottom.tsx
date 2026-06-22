/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panels Right Bottom icon (Lucide). https://lucide.dev/icons/panels-right-bottom */
export function PanelsRightBottom(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 15h12"></path>
      <path d="M15 3v18"></path>
    </svg>
  );
}
