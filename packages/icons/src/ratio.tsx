/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Ratio icon (Lucide). https://lucide.dev/icons/ratio */
export function Ratio(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="12" height="20" x="6" y="2" rx="2"></rect>
      <rect width="20" height="12" x="2" y="6" rx="2"></rect>
    </svg>
  );
}
