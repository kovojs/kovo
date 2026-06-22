/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Chevrons Down icon (Lucide). https://lucide.dev/icons/chevrons-down */
export function ChevronsDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 6 5 5 5-5"></path>
      <path d="m7 13 5 5 5-5"></path>
    </svg>
  );
}
