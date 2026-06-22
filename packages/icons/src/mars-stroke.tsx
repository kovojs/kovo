/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Mars Stroke icon (Lucide). https://lucide.dev/icons/mars-stroke */
export function MarsStroke(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m14 6 4 4"></path>
      <path d="M17 3h4v4"></path>
      <path d="m21 3-7.75 7.75"></path>
      <circle cx="9" cy="15" r="6"></circle>
    </svg>
  );
}
