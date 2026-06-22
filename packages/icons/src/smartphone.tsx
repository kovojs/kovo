/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Smartphone icon (Lucide). https://lucide.dev/icons/smartphone */
export function Smartphone(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect>
      <path d="M12 18h.01"></path>
    </svg>
  );
}
