/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Sticker icon (Lucide). https://lucide.dev/icons/sticker */
export function Sticker(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"></path>
      <path d="M15 3v5a1 1 0 0 0 1 1h5"></path>
      <path d="M8 13h.01"></path>
      <path d="M16 13h.01"></path>
      <path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"></path>
    </svg>
  );
}
