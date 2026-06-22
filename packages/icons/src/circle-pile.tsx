/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Pile icon (Lucide). https://lucide.dev/icons/circle-pile */
export function CirclePile(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="19" r="2"></circle>
      <circle cx="12" cy="5" r="2"></circle>
      <circle cx="16" cy="12" r="2"></circle>
      <circle cx="20" cy="19" r="2"></circle>
      <circle cx="4" cy="19" r="2"></circle>
      <circle cx="8" cy="12" r="2"></circle>
    </svg>
  );
}
