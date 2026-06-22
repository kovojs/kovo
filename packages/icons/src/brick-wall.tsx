/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Brick Wall icon (Lucide). https://lucide.dev/icons/brick-wall */
export function BrickWall(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M12 9v6"></path>
      <path d="M16 15v6"></path>
      <path d="M16 3v6"></path>
      <path d="M3 15h18"></path>
      <path d="M3 9h18"></path>
      <path d="M8 15v6"></path>
      <path d="M8 3v6"></path>
    </svg>
  );
}
