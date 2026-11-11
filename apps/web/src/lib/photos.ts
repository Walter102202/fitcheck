const KEY = 'fitcheck.photos';

/**
 * Product photos are on unless switched off. `?photos=off` remembers "off" for the visit,
 * `?photos=on` forgets it; with no parameter the remembered value decides. Storage errors
 * leave photos on.
 */
export function photosEnabled(search: string = window.location.search): boolean {
  const param = new URLSearchParams(search).get('photos');
  try {
    if (param === 'off') sessionStorage.setItem(KEY, 'off');
    else if (param === 'on') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) !== 'off';
  } catch {
    return param !== 'off';
  }
}
