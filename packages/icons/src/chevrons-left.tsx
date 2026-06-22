/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Left icon (Lucide). https://lucide.dev/icons/chevrons-left */
export function ChevronsLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m11 17-5-5 5-5"></path>
      <path d="m18 17-5-5 5-5"></path>
    </svg>
  );
}
