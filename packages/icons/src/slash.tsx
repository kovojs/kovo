/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Slash icon (Lucide). https://lucide.dev/icons/slash */
export function Slash(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 2 2 22"></path>
    </svg>
  );
}
