import type { ReactNode } from 'react';
import styles from './Step.module.css';

/** One numbered step of the purchase: a white panel with its title. */
export function Step({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.step}>
      <div className={styles.title}>
        <span className={styles.n}>{n}</span>
        <h2>{title}</h2>
        {aside && <span className={`note ${styles.aside}`}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}
