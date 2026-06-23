/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Chevron Down icon (Lucide). https://lucide.dev/icons/chevron-down */
export function ChevronDown(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  );
}
