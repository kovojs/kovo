/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Separator Vertical icon (Lucide). https://lucide.dev/icons/separator-vertical */
export function SeparatorVertical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v18"></path>
      <path d="m16 16 4-4-4-4"></path>
      <path d="m8 8-4 4 4 4"></path>
    </svg>
  );
}
