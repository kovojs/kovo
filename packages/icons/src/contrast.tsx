/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Contrast icon (Lucide). https://lucide.dev/icons/contrast */
export function Contrast(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 18a6 6 0 0 0 0-12v12z"></path>
    </svg>
  );
}
