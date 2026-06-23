/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevrons Right icon (Lucide). https://lucide.dev/icons/chevrons-right */
export function ChevronsRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m6 17 5-5-5-5"></path>
      <path d="m13 17 5-5-5-5"></path>
    </svg>
  );
}
