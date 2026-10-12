'use strict';

(() => {
  if (globalThis.__jiraDateValidatorLoaded) return;
  globalThis.__jiraDateValidatorLoaded = true;

  const Content = globalThis.JiraValidatorContent;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ANALYSE_JIRA_TICKET') return false;

    void Content.analyseTicket(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));

    return true;
  });
})();
