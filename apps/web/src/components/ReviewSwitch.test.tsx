import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ReviewSwitch } from './ReviewSwitch.js';

test('the switch is a radio group with On and Off: spending cap only', () => {
  render(<ReviewSwitch value="on" onChange={vi.fn()} />);
  expect(screen.getByRole('radiogroup', { name: 'Fitcheck review' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'On' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Off: spending cap only' })).not.toBeChecked();
});

test('choosing Off calls onChange with off', () => {
  const onChange = vi.fn();
  render(<ReviewSwitch value="on" onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Off: spending cap only' }));
  expect(onChange).toHaveBeenCalledWith('off');
});

test('a disabled switch ignores clicks', () => {
  const onChange = vi.fn();
  render(<ReviewSwitch value="off" onChange={onChange} disabled />);
  const on = screen.getByRole('radio', { name: 'On' });
  expect(on).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Off: spending cap only' })).toBeDisabled();
  fireEvent.click(on);
  expect(onChange).not.toHaveBeenCalled();
});
