/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Copyleft icon (Lucide). https://lucide.dev/icons/copyleft */
export function Copyleft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.17 14.83a4 4 0 1 0 0-5.66"></path>
    </svg>
  );
}
