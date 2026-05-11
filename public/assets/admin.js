/** Admin panel client helpers (copy buttons for TOTP material). */
(() => {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has('signed_out')) {
      url.searchParams.delete('signed_out');
      changed = true;
    }
    if (url.searchParams.has('login_error')) {
      url.searchParams.delete('login_error');
      changed = true;
    }
    if (url.searchParams.has('totp_status')) {
      url.searchParams.delete('totp_status');
      changed = true;
    }
    if (url.searchParams.has('pass_status')) {
      url.searchParams.delete('pass_status');
      changed = true;
    }
    if (url.searchParams.has('admin_error')) {
      url.searchParams.delete('admin_error');
      changed = true;
    }
    if (changed) {
      const qs = url.searchParams.toString();
      const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
      window.history.replaceState({}, '', next);
    }
  } catch {
    // Ignore URL API edge cases.
  }

  const shell = document.querySelector('.shell');
  const top = document.querySelector('.top');
  const pushFlash = (text, kind = 'ok') => {
    if (!shell || !top || !text) return;
    const el = document.createElement('div');
    el.className = `flash ${kind === 'err' ? 'flash-err' : 'flash-ok'}`;
    el.textContent = text;
    top.insertAdjacentElement('afterend', el);
    setTimeout(() => {
      el.classList.add('is-hiding');
      setTimeout(() => el.remove(), 260);
    }, 2600);
  };

  const flashes = document.querySelectorAll('.flash');
  flashes.forEach((el) => {
    setTimeout(() => {
      el.classList.add('is-hiding');
      setTimeout(() => {
        el.remove();
      }, 260);
    }, 3200);
  });

  const buttons = document.querySelectorAll('.copy-btn[data-copy-value]');
  if (buttons.length) {
    const copyText = async (text) => {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        } catch {
          return false;
        }
      }
    };

    buttons.forEach((btn) => {
      const base = btn.textContent ?? 'Copy';
      btn.addEventListener('click', async () => {
        const value = (btn.dataset.copyValue ?? '').trim();
        const ok = await copyText(value);
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => {
          btn.textContent = base;
        }, 1200);
      });
    });
  }

  const forms = document.querySelectorAll('form.admin-form');
  forms.forEach((form) => {
    form.addEventListener('submit', () => {
      const actionInput = form.querySelector('input[name="action"]');
      const action = (actionInput && actionInput.value ? actionInput.value : '').trim();
      if (action === 'download_backup') {
        pushFlash('Backup download started.', 'ok');
      } else if (action === 'set_totp') {
        pushFlash('Saving TOTP settings...', 'ok');
      } else if (action === 'change_password') {
        pushFlash('Updating admin password...', 'ok');
      } else if (action === 'logout') {
        pushFlash('Signing out...', 'ok');
      }
    });
  });
})();
