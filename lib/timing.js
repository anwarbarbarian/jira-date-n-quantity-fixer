'use strict';

(function attachTiming(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidator = root.JiraValidator || {};
    Object.assign(root.JiraValidator, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createTiming() {
  return Object.freeze({
    STABLE_SAMPLE_COUNT: 3,
    STABLE_POLL_MS: 450,
    PAGE_QUIET_MS: 650,
    PRE_ANALYSIS_SETTLE_MS: 900,
    INPUT_WRITE_SETTLE_MS: 350,
    INLINE_COMMIT_MS: 700,
    BLUR_COMMIT_MS: 900,
    DIALOG_SAVE_MS: 900,
    DIALOG_CANCEL_MS: 500,
    INPUT_POLL_MS: 200,
    SAVE_VERIFY_POLL_MS: 350,
    MESSAGE_RETRY_BASE_MS: 500,
    TAB_STABLE_POLL_MS: 450
  });
});
