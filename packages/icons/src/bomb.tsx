/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bomb icon (Lucide). https://lucide.dev/icons/bomb */
export function Bomb(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="11" cy="13" r="9"></circle>
      <path d="M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95"></path>
      <path d="m22 2-1.5 1.5"></path>
    </svg>
  );
}
