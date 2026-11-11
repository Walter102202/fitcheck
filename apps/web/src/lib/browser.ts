// The only full-page navigations in the app. Tests mock this module.

export function goTo(url: string): void {
  window.location.assign(url);
}

/** Submits an empty POST form, so the server's redirects drive the browser. */
export function postForm(url: string): void {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = url;
  form.style.display = 'none';
  document.body.append(form);
  form.submit();
}
