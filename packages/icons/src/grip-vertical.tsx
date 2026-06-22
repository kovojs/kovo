/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Grip Vertical icon (Lucide). https://lucide.dev/icons/grip-vertical */
export function GripVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="9" cy="12" r="1"></circle>
      <circle cx="9" cy="5" r="1"></circle>
      <circle cx="9" cy="19" r="1"></circle>
      <circle cx="15" cy="12" r="1"></circle>
      <circle cx="15" cy="5" r="1"></circle>
      <circle cx="15" cy="19" r="1"></circle>
    </svg>
  );
}
