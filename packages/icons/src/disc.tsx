/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Disc icon (Lucide). https://lucide.dev/icons/disc */
export function Disc(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  );
}
