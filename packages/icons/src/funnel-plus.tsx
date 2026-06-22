/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Funnel Plus icon (Lucide). https://lucide.dev/icons/funnel-plus */
export function FunnelPlus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13.354 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14v6a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341l1.218-1.348"></path>
      <path d="M16 6h6"></path>
      <path d="M19 3v6"></path>
    </svg>
  );
}
