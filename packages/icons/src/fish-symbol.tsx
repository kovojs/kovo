/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Fish Symbol icon (Lucide). https://lucide.dev/icons/fish-symbol */
export function FishSymbol(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 16s9-15 20-4C11 23 2 8 2 8"></path>
    </svg>
  );
}
