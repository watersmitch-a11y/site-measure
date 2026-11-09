// Pop-up messages: confirm, OK-only alert, text prompt; and the invalid-input shake.

import { els } from './core.js';

export function flashInvalid() {
  els.addWallBtn.classList.add('invalid-shake');
  setTimeout(() => els.addWallBtn.classList.remove('invalid-shake'), 300);
}

// A question with a text box: resolves to the trimmed text, or null.
export function showPrompt(message, value = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'jobs-panel confirm-overlay';
    overlay.innerHTML = `
      <div class="jobs-panel-inner confirm-inner">
        <p class="confirm-message"></p>
        <input type="text" class="panel-input prompt-input" />
        <div class="confirm-actions">
          <button type="button" class="secondary-btn confirm-cancel">Cancel</button>
          <button type="button" class="primary-btn confirm-ok">OK</button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-message').textContent = message;
    const input = overlay.querySelector('.prompt-input');
    input.value = value;
    document.body.appendChild(overlay);
    input.focus();
    input.select();
    const finish = (ok) => {
      overlay.remove();
      resolve(ok ? input.value.trim() || null : null);
    };
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => finish(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => finish(true));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); });
  });
}

// A message with just an OK button.
export function showAlert(message) {
  return showConfirm(message, { okOnly: true });
}

export function showConfirm(message, { okOnly = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'jobs-panel confirm-overlay';
    overlay.innerHTML = `
      <div class="jobs-panel-inner confirm-inner">
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button type="button" class="secondary-btn confirm-cancel">Cancel</button>
          <button type="button" class="primary-btn confirm-ok">Confirm</button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-message').textContent = message;
    if (okOnly) overlay.querySelector('.confirm-ok').textContent = 'OK';
    document.body.appendChild(overlay);
    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => finish(false));
    if (okOnly) overlay.querySelector('.confirm-cancel').remove();
    overlay.querySelector('.confirm-ok').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}
