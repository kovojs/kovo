/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Terminal icon (Lucide). https://lucide.dev/icons/terminal */
export function Terminal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 19h8"></path>
      <path d="m4 17 6-6-6-6"></path>
    </svg>
  );
}
