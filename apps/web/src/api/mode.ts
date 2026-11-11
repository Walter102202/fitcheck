/** Fixture mode runs the whole UI on the in-browser fake API, with no backend. */
export const FIXTURES_MODE: boolean =
  import.meta.env.MODE === 'fixtures' || import.meta.env.VITE_API_MODE === 'fixtures';
