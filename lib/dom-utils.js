'use strict';

(function attachDomUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidator = root.JiraValidator || {};
    Object.assign(root.JiraValidator, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createDomUtils() {
  function normaliseText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normaliseLabel(value) {
    return normaliseText(value).replace(/:$/, '').trim().toLowerCase();
  }

  function cssEscape(value) {
    const scope = typeof globalThis !== 'undefined' ? globalThis : global;
    return scope.CSS?.escape ? scope.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function isVisible(element) {
    if (typeof Element === 'undefined' || !(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  return {
    normaliseText,
    normaliseLabel,
    cssEscape,
    escapeRegExp,
    sleep,
    isVisible
  };
});
