'use strict';

(function attachInputWriter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidatorInputWriter = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createInputWriter() {
  function isLiveDateFieldInput(input) {
    const id = String(input?.id || '').toLowerCase();
    const name = String(input?.name || '').toLowerCase();
    return id === 'customfield_16801' || name === 'customfield_16801';
  }

  function prepareLiveDateInputForEdit(input) {
    if (!isLiveDateFieldInput(input)) return false;
    input.disabled = false;
    input.readOnly = false;
    input.removeAttribute('disabled');
    input.removeAttribute('readonly');
    input.removeAttribute('aria-disabled');
    input.removeAttribute('aria-readonly');
    if (input.classList) input.classList.remove('clientreadonly');
    return true;
  }

  function writeInputValue(input, value, options = {}) {
    const useAjs = options.useAjs === true;
    const nextValue = String(value ?? '');

    prepareLiveDateInputForEdit(input);

    const tag = String(input?.tagName || '').toUpperCase();
    const prototype = tag === 'TEXTAREA'
      ? (globalThis.HTMLTextAreaElement || input.constructor).prototype
      : (globalThis.HTMLInputElement || input.constructor).prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    input.focus();
    try {
      input.select?.();
      input.setSelectionRange?.(0, String(input.value || '').length);
    } catch {
      // Some date and numeric inputs do not support text selection.
    }

    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'deleteContentBackward',
      data: null
    }));
    if (setter) setter.call(input, '');
    else input.value = '';
    input.removeAttribute('value');
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'deleteContentBackward',
      data: null
    }));

    input.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertReplacementText',
      data: nextValue
    }));
    if (setter) setter.call(input, nextValue);
    else input.value = nextValue;
    input.setAttribute('value', nextValue);

    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertReplacementText',
      data: nextValue
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: nextValue.slice(-1) || 'Unidentified',
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    if (useAjs && typeof window !== 'undefined' && window.AJS?.$) {
      try {
        window.AJS.$(input)
          .val('')
          .trigger('input')
          .val(nextValue)
          .trigger('input')
          .trigger('change');
      } catch {
        // DOM events above remain the fallback.
      }
    }

    return String(input.value || '').trim();
  }

  return {
    writeInputValue,
    isLiveDateFieldInput,
    prepareLiveDateInputForEdit
  };
});
