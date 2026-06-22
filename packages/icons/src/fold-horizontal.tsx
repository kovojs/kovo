/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Fold Horizontal icon (Lucide). https://lucide.dev/icons/fold-horizontal */
export function FoldHorizontal(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 12h6"></path>
      <path d="M22 12h-6"></path>
      <path d="M12 2v2"></path>
      <path d="M12 8v2"></path>
      <path d="M12 14v2"></path>
      <path d="M12 20v2"></path>
      <path d="m19 9-3 3 3 3"></path>
      <path d="m5 15 3-3-3-3"></path>
    </svg>
  );
}
