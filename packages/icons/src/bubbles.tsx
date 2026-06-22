/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bubbles icon (Lucide). https://lucide.dev/icons/bubbles */
export function Bubbles(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7.001 15.085A1.5 1.5 0 0 1 9 16.5"></path>
      <circle cx="18.5" cy="8.5" r="3.5"></circle>
      <circle cx="7.5" cy="16.5" r="5.5"></circle>
      <circle cx="7.5" cy="4.5" r="2.5"></circle>
    </svg>
  );
}
