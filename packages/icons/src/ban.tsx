/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Ban icon (Lucide). https://lucide.dev/icons/ban */
export function Ban(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M4.929 4.929 19.07 19.071"></path>
    </svg>
  );
}
