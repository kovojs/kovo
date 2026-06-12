import { type PrimitiveDataAttributes } from '../lib/index.js';

export type MeterDataState = 'even-less-good' | 'optimum' | 'suboptimum';

export interface MeterAttributeOptions {
  high?: number;
  low?: number;
  max?: number;
  min?: number;
  optimum?: number;
  value?: number;
  valueText?: string;
}

export interface MeterComputedState {
  high: number;
  low: number;
  max: number;
  min: number;
  optimum: number;
  state: MeterDataState;
  value: number;
  valueRatio: number;
}

export type MeterPrimitiveAttributes = PrimitiveDataAttributes &
  Readonly<Record<string, number | string>>;

type MeterRegion = 'high' | 'low' | 'middle';

export function meterValueState(options: MeterAttributeOptions = {}): MeterComputedState {
  const min = normalizeMeterMin(options.min);
  const max = normalizeMeterMax(options.max, min);
  const low = normalizeOptionalMeterPoint(options.low, min, max, min);
  const high = normalizeMeterHigh(options.high, min, max, low);
  const optimum = normalizeOptionalMeterPoint(options.optimum, min, max, (min + max) / 2);
  const value = normalizeOptionalMeterPoint(options.value, min, max, min);

  return Object.freeze({
    high,
    low,
    max,
    min,
    optimum,
    state: meterState(value, low, high, optimum),
    value,
    valueRatio: (value - min) / (max - min),
  });
}

export function meterRootAttributes(options: MeterAttributeOptions = {}): MeterPrimitiveAttributes {
  const state = meterValueState(options);

  return Object.freeze({
    'data-high': String(state.high),
    'data-low': String(state.low),
    'data-max': String(state.max),
    'data-min': String(state.min),
    'data-optimum': String(state.optimum),
    'data-state': state.state,
    'data-value': String(state.value),
    high: state.high,
    low: state.low,
    max: state.max,
    min: state.min,
    optimum: state.optimum,
    value: state.value,
    ...(options.valueText === undefined ? {} : { 'aria-valuetext': options.valueText }),
  });
}

function normalizeMeterMin(min: number | undefined): number {
  return min !== undefined && Number.isFinite(min) ? min : 0;
}

function normalizeMeterMax(max: number | undefined, min: number): number {
  const normalizedMax = max !== undefined && Number.isFinite(max) ? max : 1;
  return normalizedMax > min ? normalizedMax : min + 1;
}

function normalizeMeterHigh(
  high: number | undefined,
  min: number,
  max: number,
  low: number,
): number {
  return Math.max(normalizeOptionalMeterPoint(high, min, max, max), low);
}

function normalizeOptionalMeterPoint(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function meterState(value: number, low: number, high: number, optimum: number): MeterDataState {
  const valueRegion = meterRegion(value, low, high);
  const optimumRegion = meterRegion(optimum, low, high);

  if (valueRegion === optimumRegion) return 'optimum';
  if (valueRegion === 'middle' || optimumRegion === 'middle') return 'suboptimum';
  return 'even-less-good';
}

function meterRegion(value: number, low: number, high: number): MeterRegion {
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'middle';
}
