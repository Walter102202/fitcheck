import { Outlet } from 'react-router';
import styles from './Layout.module.css';
import { TopBar } from './TopBar.js';

export function Layout() {
  return (
    <>
      <TopBar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
