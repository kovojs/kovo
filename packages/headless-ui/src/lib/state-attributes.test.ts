import { describe, expect, it } from 'vitest';

import {
  checkedState,
  dataDisabled,
  dataOrientation,
  mergeDataAttributes,
  openState,
  pressedState,
} from './state-attributes.js';

describe('headless-ui state attributes', () => {
  it('normalizes common primitive state vocabularies into data-state', () => {
    expect(openState(true)).toEqual({ 'data-state': 'open' });
    expect(openState(false)).toEqual({ 'data-state': 'closed' });
    expect(checkedState(true)).toEqual({ 'data-state': 'checked' });
    expect(checkedState(false)).toEqual({ 'data-state': 'unchecked' });
    expect(checkedState('indeterminate')).toEqual({ 'data-state': 'indeterminate' });
    expect(pressedState(true)).toEqual({ 'data-state': 'pressed' });
    expect(pressedState(false)).toEqual({ 'data-state': 'off' });
  });

  it('omits absent boolean attributes and keeps present flags serializable', () => {
    expect(dataDisabled(false)).toEqual({});
    expect(dataDisabled(true)).toEqual({ 'data-disabled': '' });
    expect(dataOrientation('horizontal')).toEqual({ 'data-orientation': 'horizontal' });
  });

  it('merges primitive data attributes deterministically', () => {
    expect(
      mergeDataAttributes(
        openState(true),
        dataDisabled(true),
        { 'data-kovo-test': 'author' },
        openState(false),
      ),
    ).toEqual({
      'data-disabled': '',
      'data-kovo-test': 'author',
      'data-state': 'closed',
    });
  });
});
