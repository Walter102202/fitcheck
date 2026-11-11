import { Link, useLocation } from 'react-router';
import { useAppConfig } from '../api/config.js';
import { GITHUB_URL } from '../lib/links.js';
import { reviewChip } from '../lib/model.js';
import styles from './TopBar.module.css';

export function TopBar() {
  const { pathname } = useLocation();
  const config = useAppConfig().data;
  const chip = config ? reviewChip(config.reviewModel, config.reviewSource) : null;
  const onResults = pathname === '/results';
  return (
    <header className={styles.topbar}>
      <div className={`wrap ${styles.inner}`}>
        <Link className={styles.wordmark} to="/">
          Fitcheck
        </Link>
        <nav className={styles.topnav} aria-label="Main">
          <Link to="/" {...(onResults ? {} : { 'aria-current': 'page' as const })}>
            Run a purchase
          </Link>
          <Link to="/results" {...(onResults ? { 'aria-current': 'page' as const } : {})}>
            Results
          </Link>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
        {config && chip && (
          <div className={styles.modes}>
            <span className={styles.mode}>
              Review: <b>{chip.name}</b>
              {chip.detail && ` · ${chip.detail}`}
            </span>
            <span className={styles.mode}>
              PayPal: <b>{config.paypalMode}</b>
            </span>
            <span className={styles.mode}>
              Channel3: <b>{config.channel3Mode === 'live' ? 'live' : 'recorded copy'}</b>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
