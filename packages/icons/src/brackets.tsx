/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Brackets icon (Lucide). https://lucide.dev/icons/brackets */
export function Brackets(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3"></path>
      <path d="M8 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3"></path>
    </svg>
  );
}
