/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Minimize 2 icon (Lucide). https://lucide.dev/icons/minimize-2 */
export function Minimize2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m14 10 7-7"></path>
      <path d="M20 10h-6V4"></path>
      <path d="m3 21 7-7"></path>
      <path d="M4 14h6v6"></path>
    </svg>
  );
}
