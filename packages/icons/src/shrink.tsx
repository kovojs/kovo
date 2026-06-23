/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Shrink icon (Lucide). https://lucide.dev/icons/shrink */
export function Shrink(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"></path>
      <path d="M9 19.8V15m0 0H4.2M9 15l-6 6"></path>
      <path d="M15 4.2V9m0 0h4.8M15 9l6-6"></path>
      <path d="M9 4.2V9m0 0H4.2M9 9 3 3"></path>
    </svg>
  );
}
