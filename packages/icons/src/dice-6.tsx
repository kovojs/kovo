/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Dice 6 icon (Lucide). https://lucide.dev/icons/dice-6 */
export function Dice6(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
      <path d="M16 8h.01"></path>
      <path d="M16 12h.01"></path>
      <path d="M16 16h.01"></path>
      <path d="M8 8h.01"></path>
      <path d="M8 12h.01"></path>
      <path d="M8 16h.01"></path>
    </svg>
  );
}
