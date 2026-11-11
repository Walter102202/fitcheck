import { useId } from 'react';
import styles from './ReviewSwitch.module.css';

const OPTIONS = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off: spending cap only' },
] as const;

/** Runs the same purchase with or without Fitcheck's review. */
export function ReviewSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: 'on' | 'off';
  onChange: (v: 'on' | 'off') => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className={styles.switch} role="radiogroup" aria-label="Fitcheck review">
      {OPTIONS.map((option) => (
        <span key={option.value} className={styles.option}>
          <input
            type="radio"
            id={`${id}-${option.value}`}
            name="review"
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => {
              if (!disabled) onChange(option.value);
            }}
          />
          <label htmlFor={`${id}-${option.value}`}>{option.label}</label>
        </span>
      ))}
    </span>
  );
}
