/** @jsxImportSource @kovojs/server */
import type { ComponentRenderResult } from '@kovojs/core';
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Flask Round icon (Lucide). https://lucide.dev/icons/flask-round */
export function FlaskRound(props: IconProps = {}): ComponentRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 2v6.292a7 7 0 1 0 4 0V2"></path>
      <path d="M5 15h14"></path>
      <path d="M8.5 2h7"></path>
    </svg>
  );
}
