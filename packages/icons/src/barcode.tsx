/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Barcode icon (Lucide). https://lucide.dev/icons/barcode */
export function Barcode(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5v14"></path>
      <path d="M8 5v14"></path>
      <path d="M12 5v14"></path>
      <path d="M17 5v14"></path>
      <path d="M21 5v14"></path>
    </svg>
  );
}
