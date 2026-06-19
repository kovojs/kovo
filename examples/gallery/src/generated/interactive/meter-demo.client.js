// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import { meterValueState as _meterValueState } from '@kovojs/headless-ui/meter';

export const GalleryMeterDemo$Button_click = handler((_event, ctx) => {
  const value = ctx.state.value === 92 ? 72 : 92;
  ctx.state.value = value;
  ctx.state.dataState = _meterValueState({
    high: 80,
    low: 40,
    max: 100,
    min: 0,
    optimum: 90,
    value,
  }).state;
});

export const GalleryMeterDemo$Meter_aria_valuetext_derive = derive(
  ['state'],
  (state) => `${state.value} percent capacity`,
);
export const GalleryMeterDemo$Meter_data_state_derive = derive(
  ['state'],
  (state) => state.dataState,
);
export const GalleryMeterDemo$Meter_value_derive = derive(['state'], (state) => state.value);
export const GalleryMeterDemo$output_text_derive = derive(['state'], (state) =>
  String(state.value),
);
