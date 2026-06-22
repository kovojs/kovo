/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Album icon (Lucide). https://lucide.dev/icons/album */
export function Album(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
      <polyline points="11 3 11 11 14 8 17 11 17 3"></polyline>
    </svg>
  );
}
