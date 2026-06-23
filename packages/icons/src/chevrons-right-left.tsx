/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevrons Right Left icon (Lucide). https://lucide.dev/icons/chevrons-right-left */
export function ChevronsRightLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m20 17-5-5 5-5"></path>
      <path d="m4 17 5-5-5-5"></path>
    </svg>
  );
}
