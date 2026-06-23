/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Russian Ruble icon (Lucide). https://lucide.dev/icons/russian-ruble */
export function RussianRuble(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 11h8a4 4 0 0 0 0-8H9v18"></path>
      <path d="M6 15h8"></path>
    </svg>
  );
}
