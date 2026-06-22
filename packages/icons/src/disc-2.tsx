/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Disc 2 icon (Lucide). https://lucide.dev/icons/disc-2 */
export function Disc2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 12h.01"></path>
    </svg>
  );
}
