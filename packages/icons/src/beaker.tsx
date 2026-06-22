/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Beaker icon (Lucide). https://lucide.dev/icons/beaker */
export function Beaker(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4.5 3h15"></path>
      <path d="M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3"></path>
      <path d="M6 14h12"></path>
    </svg>
  );
}
