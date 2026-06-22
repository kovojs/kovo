/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Italic icon (Lucide). https://lucide.dev/icons/italic */
export function Italic(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="19" x2="10" y1="4" y2="4"></line>
      <line x1="14" x2="5" y1="20" y2="20"></line>
      <line x1="15" x2="9" y1="4" y2="20"></line>
    </svg>
  );
}
