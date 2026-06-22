/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Down Up icon (Lucide). https://lucide.dev/icons/chevrons-down-up */
export function ChevronsDownUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 20 5-5 5 5"></path>
      <path d="m7 4 5 5 5-5"></path>
    </svg>
  );
}
