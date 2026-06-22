/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle User Round icon (Lucide). https://lucide.dev/icons/circle-user-round */
export function CircleUserRound(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M17.925 20.056a6 6 0 0 0-11.851.001"></path>
      <circle cx="12" cy="11" r="4"></circle>
      <circle cx="12" cy="12" r="10"></circle>
    </svg>
  );
}
