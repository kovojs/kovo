/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Fold Vertical icon (Lucide). https://lucide.dev/icons/fold-vertical */
export function FoldVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 22v-6"></path>
      <path d="M12 8V2"></path>
      <path d="M4 12H2"></path>
      <path d="M10 12H8"></path>
      <path d="M16 12h-2"></path>
      <path d="M22 12h-2"></path>
      <path d="m15 19-3-3-3 3"></path>
      <path d="m15 5-3 3-3-3"></path>
    </svg>
  );
}
