'use strict';

/**
 * @mention autocomplete for textareas and text inputs.
 * Uses state.staff (global) for the list of active staff.
 *
 * Usage:
 *   initMentions('f-notes')   — attach to element with id="f-notes"
 *   destroyMentions('f-notes') — cleanup (call on modal close)
 */

const _mentionInstances = {};

function initMentions(inputId) {
  destroyMentions(inputId); // clean up any prior instance

  const el = document.getElementById(inputId);
  if (!el) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'mention-dropdown';
  dropdown.style.display = 'none';
  document.body.appendChild(dropdown);

  let activeIndex = 0;
  let filtered = [];
  let mentionStart = -1; // cursor position of the '@'

  function getActiveStaff() {
    return (state.staff || []).filter(s => s.Active !== 'false').sort((a, b) => a.Name.localeCompare(b.Name));
  }

  function positionDropdown() {
    const rect = el.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.minWidth = Math.min(rect.width, 280) + 'px';
    dropdown.style.maxWidth = '320px';
  }

  function renderDropdown() {
    if (filtered.length === 0) {
      dropdown.style.display = 'none';
      return;
    }
    if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
    if (activeIndex < 0) activeIndex = 0;
    dropdown.innerHTML = filtered.map((s, i) =>
      `<div class="mention-item${i === activeIndex ? ' active' : ''}" data-index="${i}">${esc(s.Name)}${s.Role ? ' <span style="opacity:.6">(' + esc(s.Role) + ')</span>' : ''}</div>`
    ).join('');
    dropdown.style.display = 'block';
    positionDropdown();

    // Scroll active item into view
    const activeEl = dropdown.querySelector('.mention-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function selectStaff(staff) {
    const before = el.value.substring(0, mentionStart);
    const after = el.value.substring(el.selectionStart);
    const mention = '@' + staff.Name + ' ';
    el.value = before + mention + after;
    const newPos = before.length + mention.length;
    el.setSelectionRange(newPos, newPos);
    el.focus();
    closeDropdown();
    // Trigger input event so any listeners know the value changed
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    filtered = [];
    mentionStart = -1;
    activeIndex = 0;
  }

  function onInput() {
    const cursorPos = el.selectionStart;
    const text = el.value;

    // Find the '@' that triggered this mention
    // Walk backwards from cursor to find an unescaped '@'
    let atPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '@') {
        // '@' must be at start of text or preceded by whitespace/newline
        if (i === 0 || /\s/.test(text[i - 1])) {
          atPos = i;
        }
        break;
      }
      // Stop if we hit whitespace before finding '@' — no mention
      if (ch === '\n' || ch === '\r') break;
    }

    if (atPos === -1) {
      closeDropdown();
      return;
    }

    mentionStart = atPos;
    const query = text.substring(atPos + 1, cursorPos).toLowerCase();
    const all = getActiveStaff();
    filtered = query ? all.filter(s => s.Name.toLowerCase().includes(query)) : all;
    activeIndex = 0;
    renderDropdown();
  }

  function onKeyDown(e) {
    if (dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
      renderDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderDropdown();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        selectStaff(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    }
  }

  function onDropdownClick(e) {
    const item = e.target.closest('.mention-item');
    if (!item) return;
    const idx = parseInt(item.dataset.index);
    if (filtered[idx]) selectStaff(filtered[idx]);
  }

  function onDocClick(e) {
    if (!dropdown.contains(e.target) && e.target !== el) {
      closeDropdown();
    }
  }

  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKeyDown);
  dropdown.addEventListener('mousedown', onDropdownClick);
  document.addEventListener('click', onDocClick);

  _mentionInstances[inputId] = {
    el,
    dropdown,
    onInput,
    onKeyDown,
    onDropdownClick,
    onDocClick,
  };
}

function destroyMentions(inputId) {
  const inst = _mentionInstances[inputId];
  if (!inst) return;

  inst.el.removeEventListener('input', inst.onInput);
  inst.el.removeEventListener('keydown', inst.onKeyDown);
  inst.dropdown.removeEventListener('mousedown', inst.onDropdownClick);
  document.removeEventListener('click', inst.onDocClick);
  if (inst.dropdown.parentNode) inst.dropdown.parentNode.removeChild(inst.dropdown);
  delete _mentionInstances[inputId];
}

function destroyAllMentions() {
  for (const id of Object.keys(_mentionInstances)) destroyMentions(id);
}
