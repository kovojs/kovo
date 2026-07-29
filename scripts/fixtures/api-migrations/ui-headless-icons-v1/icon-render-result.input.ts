// @ts-nocheck -- migration input intentionally imports a removed public symbol.
import type { IconProps, IconRenderResult as RenderedIcon } from '@kovojs/icons';

export interface AppIcon {
  props: IconProps;
  render(): RenderedIcon;
}
