'use strict';

(() => {
  const {
    normaliseText,
    normaliseLabel,
    cssEscape,
    escapeRegExp,
    sleep,
    isVisible
  } = globalThis.JiraValidator;

  const Content = globalThis.JiraValidatorContent = globalThis.JiraValidatorContent || {};
  Object.assign(Content, {
    normaliseText,
    normaliseLabel,
    cssEscape,
    escapeRegExp,
    sleep,
    isVisible,
    TIMING: {
      STABLE_SAMPLE_COUNT: globalThis.JiraValidator.STABLE_SAMPLE_COUNT,
      STABLE_POLL_MS: globalThis.JiraValidator.STABLE_POLL_MS,
      PAGE_QUIET_MS: globalThis.JiraValidator.PAGE_QUIET_MS,
      INPUT_WRITE_SETTLE_MS: globalThis.JiraValidator.INPUT_WRITE_SETTLE_MS,
      INLINE_COMMIT_MS: globalThis.JiraValidator.INLINE_COMMIT_MS,
      BLUR_COMMIT_MS: globalThis.JiraValidator.BLUR_COMMIT_MS,
      DIALOG_SAVE_MS: globalThis.JiraValidator.DIALOG_SAVE_MS,
      DIALOG_CANCEL_MS: globalThis.JiraValidator.DIALOG_CANCEL_MS,
      INPUT_POLL_MS: globalThis.JiraValidator.INPUT_POLL_MS,
      SAVE_VERIFY_POLL_MS: globalThis.JiraValidator.SAVE_VERIFY_POLL_MS
    }
  });

  function readElementValue(element) {
    if (!element) return '';
    return normaliseText([
      element.value,
      element.getAttribute?.('datetime'),
      element.getAttribute?.('data-datetime'),
      element.getAttribute?.('data-date'),
      element.getAttribute?.('data-value'),
      element.getAttribute?.('data-time'),
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.innerText,
      element.textContent
    ].filter(Boolean).join(' '));
  }

  async function runMainWorldAction(payload) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_JIRA_MAIN_WORLD',
        payload
      });
      if (!response?.ok) {
        return { success: false, message: response?.error || 'MAIN-world action failed.' };
      }
      return {
        ...(response.result || {}),
        success: response.result?.success !== false,
        message: response.result?.message || 'MAIN-world action completed.'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function setInputValue(input, value) {
    const writer = globalThis.JiraValidatorInputWriter;
    return writer.writeInputValue(input, value, { useAjs: false });
  }

  function dispatchUserLikeClick(element, options = {}) {
    if (!element) return false;
    try {
      element.focus?.({ preventScroll: true });
    } catch {
      // Ignore focus errors on detached elements.
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: Math.round(element.getBoundingClientRect?.().left || 0) + 2,
      clientY: Math.round(element.getBoundingClientRect?.().top || 0) + 2
    };

    const anchor = element.closest?.('a[href]');
    let preventNavigation = null;
    if (options.preventAnchorNavigation && anchor) {
      preventNavigation = (event) => event.preventDefault();
      anchor.addEventListener('click', preventNavigation, { capture: true, once: true });
    }

    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
    }
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    element.click();

    if (preventNavigation) {
      queueMicrotask(() => anchor.removeEventListener('click', preventNavigation, true));
    }
    return true;
  }

  function activateWithKeyboard(element) {
    try {
      element.focus?.({ preventScroll: true });
    } catch {
      // Ignore focus errors.
    }
    for (const type of ['keydown', 'keypress', 'keyup']) {
      element.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    }
  }

  function describeElement(element) {
    if (!element) return 'unknown control';
    const id = element.id ? `#${element.id}` : '';
    const classes = element.classList?.length ? `.${[...element.classList].slice(0, 3).join('.')}` : '';
    const text = normaliseText(element.getAttribute?.('aria-label') || element.textContent || '').slice(0, 80);
    return `${element.tagName?.toLowerCase() || 'element'}${id}${classes}${text ? ` (“${text}”)` : ''}`;
  }

  function blurInputAndFocusPage(input) {
    input.dispatchEvent(new FocusEvent('focusout', {
      bubbles: true,
      composed: true,
      relatedTarget: document.body
    }));
    input.blur();

    const oldTabIndex = document.body.getAttribute('tabindex');
    document.body.setAttribute('tabindex', '-1');
    document.body.focus({ preventScroll: true });
    if (oldTabIndex === null) document.body.removeAttribute('tabindex');
    else document.body.setAttribute('tabindex', oldTabIndex);
  }

  function getSearchRoots() {
    const roots = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        if (frame.contentDocument) roots.push(frame.contentDocument);
      } catch {
        // Cross-origin frames cannot be inspected by the extension page script.
      }
    }
    return roots;
  }

  function isInsideEditIssueContainer(element) {
    return Boolean(element?.closest?.(
      '[role="dialog"], .aui-dialog, .aui-dialog2, form#issue-edit, form#issue-edit-form, form[id*="edit-issue" i], form[action*="EditIssue" i]'
    ));
  }

  function findControlInRoots(roots, selectors, textPattern, globalRoot) {
    for (const root of roots) {
      for (const selector of selectors) {
        let controls = [];
        try {
          controls = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }

        const exact = controls.find((control) => {
          const text = normaliseText(
            control.value || control.innerText || control.textContent || control.getAttribute('aria-label') || control.getAttribute('title') || ''
          );
          return textPattern.test(text);
        });
        if (exact) return exact;

        if (controls.length === 1 && root !== globalRoot) return controls[0];
      }
    }
    return null;
  }

  Object.assign(Content, {
    readElementValue,
    runMainWorldAction,
    setInputValue,
    dispatchUserLikeClick,
    activateWithKeyboard,
    describeElement,
    blurInputAndFocusPage,
    getSearchRoots,
    isInsideEditIssueContainer,
    findControlInRoots
  });
})();
