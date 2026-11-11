import styles from './Notices.module.css';

/** Fallback notices from the run (Channel3 recording, simulated PayPal, cap left), verbatim. */
export function Notices({ notices }: { notices: string[] }) {
  if (notices.length === 0) return null;
  return (
    <ul className={styles.notices} role="status">
      {notices.map((notice) => (
        <li key={notice}>{notice}</li>
      ))}
    </ul>
  );
}
