/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Remove Formatting icon (Lucide). https://lucide.dev/icons/remove-formatting */
export function RemoveFormatting(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 7V4h16v3"></path>
      <path d="M5 20h6"></path>
      <path d="M13 4 8 20"></path>
      <path d="m15 15 5 5"></path>
      <path d="m20 15-5 5"></path>
    </svg>
  );
}
