/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cloud Lightning icon (Lucide). https://lucide.dev/icons/cloud-lightning */
export function CloudLightning(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"></path>
      <path d="m13 12-3 5h4l-3 5"></path>
    </svg>
  );
}
