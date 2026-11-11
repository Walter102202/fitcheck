import { Link } from 'react-router';
import styles from './NotFound.module.css';

export function NotFound() {
  return (
    <div className={`wrap ${styles.page}`}>
      <h1 className={styles.title}>This page does not exist.</h1>
      <p>
        <Link to="/">Go to the first screen</Link>
      </p>
    </div>
  );
}
