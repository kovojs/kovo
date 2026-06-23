/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevrons Down Up icon (Lucide). https://lucide.dev/icons/chevrons-down-up */
export function ChevronsDownUp(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 20 5-5 5 5"></path>
      <path d="m7 4 5 5 5-5"></path>
    </svg>
  );
}
