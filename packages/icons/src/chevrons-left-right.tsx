/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevrons Left Right icon (Lucide). https://lucide.dev/icons/chevrons-left-right */
export function ChevronsLeftRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m9 7-5 5 5 5"></path>
      <path d="m15 7 5 5-5 5"></path>
    </svg>
  );
}
