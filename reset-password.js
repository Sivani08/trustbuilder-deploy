(() => {
  let token = new URLSearchParams(location.hash.slice(1)).get('token');
  // Keep reset secrets out of URLs, referrers, persistent storage and server logs.
  if (location.hash) history.replaceState(null, '', location.pathname);
  const form = document.querySelector('#resetForm');
  const button = document.querySelector('#resetSubmit');
  const error = document.querySelector('#resetError');
  const status = document.querySelector('#resetStatus');
  if (token) {
    document.querySelector('#resetHeading').textContent = 'Choose a new password';
    document.querySelector('#resetDescription').textContent = 'After saving, sign in with your new password. Your other login sessions will be signed out.';
    document.querySelector('#emailFields').hidden = true;
    document.querySelector('#resetEmail').disabled = true;
    document.querySelector('#passwordFields').hidden = false;
    for (const input of document.querySelectorAll('#passwordFields input')) { input.disabled = false; input.required = true; }
    button.textContent = 'Save new password';
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    error.hidden = true; status.hidden = true;
    const values = Object.fromEntries(new FormData(form));
    if (token && values.password !== values.confirmPassword) {
      error.textContent = 'Passwords do not match. Please try again.'; error.hidden = false;
      document.querySelector('#confirmPassword').focus(); return;
    }
    const label = button.textContent;
    button.disabled = true; button.textContent = token ? 'Saving…' : 'Sending…';
    try {
      const response = await fetch(token ? '/api/auth/reset-password' : '/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(token ? { token, password: values.password } : { email: values.email }),
        signal: AbortSignal.timeout(45000)
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.error?.code === 'INVALID_RESET_LINK') document.querySelector('#newResetLink').hidden = false;
        throw new Error(payload.error?.message || 'The request could not be completed. Please try again.');
      }
      status.className = 'auth-success'; status.textContent = payload.message; status.hidden = false;
      form.reset(); form.hidden = true;
      if (token) { token = null; localStorage.removeItem('trustbuilder-state'); }
      else {
        document.querySelector('#resetDescription').textContent = 'Reset links expire after 30 minutes. If an email does not arrive, check spam or contact your administrator. You can request another link after 15 minutes.';
        document.querySelector('#newResetLink').hidden = false;
      }
    } catch (failure) {
      error.textContent = failure.name === 'TimeoutError' ? 'The request timed out. Please try again.' : failure.message;
      error.hidden = false; error.focus();
    } finally { button.disabled = false; button.textContent = label; }
  });
})();
