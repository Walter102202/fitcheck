import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import styles from './Button.module.css';

type Look = { variant?: 'primary' | 'quiet'; size?: 'normal' | 'small' };

export function Button({
  variant = 'primary',
  size = 'normal',
  type = 'button',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & Look) {
  return (
    <button
      {...rest}
      type={type}
      className={className ? `${styles.btn} ${className}` : styles.btn}
      data-variant={variant}
      data-size={size}
    />
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'normal',
  className,
  ...rest
}: LinkProps & Look) {
  return (
    <Link
      {...rest}
      className={className ? `${styles.btn} ${className}` : styles.btn}
      data-variant={variant}
      data-size={size}
    />
  );
}
