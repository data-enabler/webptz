import { useId, useLocalStorage } from './hooks.js';
import { html, useEffect, useRef, useState } from 'htm/preact';

/** @typedef {'auto'|'light'|'dark'} Theme */

export function Settings() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [theme, setTheme] = useLocalStorage('theme', /** @type {Theme} */('auto'));
  const dialogRef = useRef(/** @type {HTMLDialogElement|null} */ (null));
  useEffect(() => {
    if (dialogOpen) {
      dialogRef.current?.showModal();
      dialogRef.current
        ?.querySelector('[autofocus]')
        ?.scrollIntoView();
    } else {
      dialogRef.current?.close();
    }
  }, [dialogOpen]);
  useEffect(() => {
    if (!dialogRef.current) {
      return;
    }
    function closeDialog() {
      setDialogOpen(false);
    }
    /** @param {MouseEvent} e */
    function handleClickOutside(e) {
      if (e.target === dialogRef.current) {
        closeDialog();
      }
    }
    dialogRef.current.addEventListener('close', closeDialog);
    dialogRef.current.addEventListener('click', handleClickOutside);
    return () => {
      dialogRef.current?.removeEventListener('close', closeDialog);
      dialogRef.current?.removeEventListener('click', handleClickOutside);
    };
  }, [setDialogOpen])

  function openDialog() {
    setDialogOpen(true);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return html`
    <button
      type="button"
      class="settings__trigger"
      title="Settings"
      aria-label="Settings"
      onClick=${openDialog}
    >
      ⚙\uFE0F
    </button>
    <dialog ref=${dialogRef}>
      <form method="dialog">
        <div class="settings__container">
          <h2 class="settings__heading">Settings</h2>
          <fieldset class="settings__section">
            <legend>Theme</legend>
            <label>
              <input type="radio" name="theme" value="auto" checked=${theme === 'auto'} onChange=${() => setTheme('auto')} />
              ${' '}
              Auto
            </label>
            ${' '}
            <label>
              <input type="radio" name="theme" value="light" checked=${theme === 'light'} onChange=${() => setTheme('light')} />
              ${' '}
              Light
            </label>
            ${' '}
            <label>
              <input type="radio" name="theme" value="dark" checked=${theme === 'dark'} onChange=${() => setTheme('dark')} />
              ${' '}
              Dark
            </label>
          </fieldset>
          <div class="settings__actions">
            <button type="submit">Close</button>
          </div>
        </div>
      </form>
    </dialog>
  `;
}
