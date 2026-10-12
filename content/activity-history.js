'use strict';

(() => {
  const Content = globalThis.JiraValidatorContent = globalThis.JiraValidatorContent || {};
  const JV = globalThis.JiraValidator;
  const { sleep, dispatchUserLikeClick, isVisible, TIMING } = Content;
  const { findReadyForLiveToLiveTransition } = JV;

  async function ensureChangeHistoryTabVisible() {
    const activePanel = document.querySelector('#changehistory-tabpanel-tabpanel.active-pane, #changehistory-tabpanel-tabpanel[role="tabpanel"]');
    if (activePanel?.querySelector('.issue-data-block, .changehistory')) {
      return true;
    }

    const tabLink = document.querySelector(
      '#changehistory-tabpanel-link, a[data-key*="changehistory-tabpanel"], li#changehistory-tabpanel a'
    );
    if (!tabLink) return false;

    dispatchUserLikeClick(tabLink, { preventAnchorNavigation: true });
    await sleep(TIMING.PAGE_QUIET_MS);

    return Boolean(document.querySelector('#changehistory-tabpanel-tabpanel .issue-data-block, #issue_actions_container .issue-data-block'));
  }

  function findLoadMoreHistoryButton() {
    const selectors = [
      'button.show-more-changehistory-tabpanel',
      'button.collapsed-changehistory-tabpanel',
      'button[data-fetch-mode="older"]'
    ];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && isVisible(button)) return button;
    }
    return null;
  }

  async function resolveLiveDateFromIssueHistory(settings = {}) {
    if (settings.useLiveDateFromStatusHistory === false) {
      return { date: null, message: 'Live Date from issue history is disabled in settings.' };
    }

    const module = document.querySelector('#activitymodule, #activitymodule_heading');
    if (module) {
      try {
        module.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch {
        // Optional in background tabs.
      }
    }

    const tabReady = await ensureChangeHistoryTabVisible();
    if (!tabReady) {
      return { date: null, message: 'Jira change history was not visible on the issue page.' };
    }

    const transitionOptions = {
      fromStatus: settings.liveStatusTransitionFrom || 'READY FOR LIVE',
      toStatus: settings.liveStatusTransitionTo || 'LIVE'
    };

    const maxLoads = Math.min(Math.max(Number(settings.maxHistoryLoadMoreClicks) || 5, 0), 20);
    let transition = findReadyForLiveToLiveTransition(document, transitionOptions);
    let loadAttempts = 0;

    while (!transition && loadAttempts < maxLoads) {
      const loadMore = findLoadMoreHistoryButton();
      if (!loadMore) break;
      dispatchUserLikeClick(loadMore);
      await sleep(Math.max(TIMING.PAGE_QUIET_MS, 1500));
      transition = findReadyForLiveToLiveTransition(document, transitionOptions);
      loadAttempts += 1;
    }

    if (!transition?.date) {
      return {
        date: null,
        message: `No ${transitionOptions.fromStatus} → ${transitionOptions.toStatus} status change was found in issue history.`
      };
    }

    return {
      date: transition.date,
      rawTimestamp: transition.rawTimestamp,
      isoTimestamp: transition.isoTimestamp,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      message: `Live Date inferred from status change ${transition.fromStatus} → ${transition.toStatus} on ${transition.rawTimestamp || 'history timestamp'}.`
    };
  }

  Object.assign(Content, {
    resolveLiveDateFromIssueHistory,
    ensureChangeHistoryTabVisible
  });
})();
