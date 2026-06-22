/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Scale icon (Lucide). https://lucide.dev/icons/scale */
export function Scale(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v18"></path>
      <path d="m19 8 3 8a5 5 0 0 1-6 0zV7"></path>
      <path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"></path>
      <path d="m5 8 3 8a5 5 0 0 1-6 0zV7"></path>
      <path d="M7 21h10"></path>
    </svg>
  );
}
