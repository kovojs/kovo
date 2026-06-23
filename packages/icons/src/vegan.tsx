/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Vegan icon (Lucide). https://lucide.dev/icons/vegan */
export function Vegan(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 8q6 0 6-6-6 0-6 6"></path>
      <path d="M17.41 3.59a10 10 0 1 0 3 3"></path>
      <path d="M2 2a26.6 26.6 0 0 1 10 20c.9-6.82 1.5-9.5 4-14"></path>
    </svg>
  );
}
