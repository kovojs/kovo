/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Turkish Lira icon (Lucide). https://lucide.dev/icons/turkish-lira */
export function TurkishLira(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 4 5 9"></path>
      <path d="m15 8.5-10 5"></path>
      <path d="M18 12a9 9 0 0 1-9 9V3"></path>
    </svg>
  );
}
