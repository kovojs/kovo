/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Tornado icon (Lucide). https://lucide.dev/icons/tornado */
export function Tornado(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 4H3"></path>
      <path d="M18 8H6"></path>
      <path d="M19 12H9"></path>
      <path d="M16 16h-6"></path>
      <path d="M11 20H9"></path>
    </svg>
  );
}
