/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Globe Check icon (Lucide). https://lucide.dev/icons/globe-check */
export function GlobeCheck(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 6 2 2 4-4"></path>
      <path d="M2 12h20A10 10 0 1 1 12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 4-10"></path>
    </svg>
  );
}
