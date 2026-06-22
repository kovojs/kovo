/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Plug 2 icon (Lucide). https://lucide.dev/icons/plug-2 */
export function Plug2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M9 2v6"></path>
      <path d="M15 2v6"></path>
      <path d="M12 17v5"></path>
      <path d="M5 8h14"></path>
      <path d="M6 11V8h12v3a6 6 0 1 1-12 0Z"></path>
    </svg>
  );
}
