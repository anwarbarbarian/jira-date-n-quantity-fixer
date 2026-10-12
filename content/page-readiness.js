'use strict';

(() => {
  const Content = globalThis.JiraValidatorContent = globalThis.JiraValidatorContent || {};
  const JV = globalThis.JiraValidator;
  const { sleep, normaliseText, isVisible, runMainWorldAction, TIMING } = Content;
  const { fieldPresent, issueFieldsReady, isAemOptionalIssueType, normaliseDetectedIssueTypeName } = JV;

  function detectDeadLinkPage() {
    const title = normaliseText(document.title || '').toLowerCase();
    const body = normaliseText(document.body?.innerText || document.body?.textContent || '').toLowerCase();
    const sample = `${title} ${body.slice(0, 6000)}`;
    return sample.includes("oops, you've found a dead link") ||
      sample.includes('oops, you’ve found a dead link') ||
      (/\bdead link\b/.test(sample) && sample.includes('jira'));
  }

  function detectIssueKeyFromUrl() {
    const match = location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
    return match ? match[1].toUpperCase() : '';
  }

  function hasBlockingPageLoader() {
    const selectors = [
      '.aui-blanket[aria-hidden="false"]',
      '.aui-blanket:not([aria-hidden])',
      '[aria-busy="true"]',
      '.loading:not([aria-hidden="true"])',
      '.aui-spinner:not([aria-hidden="true"])'
    ];

    for (const selector of selectors) {
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        continue;
      }
      if (elements.some((element) => isVisible(element) && !element.closest('[role="dialog"], .aui-dialog, .aui-dialog2'))) {
        return true;
      }
    }
    return false;
  }

  function isAuthenticationPage(ticket) {
    const url = location.href.toLowerCase();
    const body = normaliseText(document.body?.innerText || '').toLowerCase();
    const title = document.title.toLowerCase();
    const hasTicket = body.includes(ticket.toLowerCase());

    return !hasTicket && (
      url.includes('/login') ||
      url.includes('login.jsp') ||
      title.includes('log in') ||
      title.includes('sign in') ||
      /\b(log in|sign in)\b/.test(body.slice(0, 1500))
    );
  }

  function detectIssueKey() {
    const match = location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
    if (match) return match[1].toUpperCase();

    const body = normaliseText(document.body?.innerText || '');
    const key = body.match(/\b[A-Z][A-Z0-9_]+-\d+\b/);
    return key ? key[0] : '';
  }

  function findIssueTypeElement() {
    const primary = document.querySelector('#type-val, [id="type-val"]');
    if (primary) return primary;

    const dataIssueType = document.querySelector('[data-issue-type]');
    if (dataIssueType) return dataIssueType;

    const issuetypeValue = document.querySelector('.issuetype .value, .issue-type-field .value, li.issuetype .value');
    if (issuetypeValue) return issuetypeValue;

    const labels = document.querySelectorAll('#issuedetails .name, #issuedetails strong.name');
    for (const label of labels) {
      const labelText = normaliseText(label.textContent || '').toLowerCase();
      if (labelText !== 'type:' && labelText !== 'type') continue;
      const row = label.closest('li, tr, .item');
      const value = row?.querySelector('.value, span.value, [id$="-val"]');
      if (value) return value;
    }
    return null;
  }

  function detectIssueTypeName() {
    const element = findIssueTypeElement();
    if (!element) return '';

    const candidates = [];
    const pushCandidate = (value) => {
      const text = String(value || '').trim();
      if (text) candidates.push(text);
    };

    pushCandidate(element.getAttribute('data-issue-type'));

    for (const img of element.querySelectorAll('img[title]')) {
      pushCandidate(img.getAttribute('title'));
    }

    const ariaLabelled = element.querySelector('[aria-label]');
    if (ariaLabelled) pushCandidate(ariaLabelled.getAttribute('aria-label'));
    pushCandidate(element.getAttribute('aria-label'));

    pushCandidate(element.textContent);
    pushCandidate(element.innerText);

    for (const raw of candidates) {
      const normalised = normaliseDetectedIssueTypeName(raw);
      if (normalised) return normalised;
    }
    return '';
  }

  async function waitForPage(ticket, timeoutMs, options = {}) {
    const settings = options.settings || {};
    const started = Date.now();
    const requireIssueFields = options.requireIssueFields !== false;
    let stableSamples = 0;
    let lastSignature = '';
    let lastReason = 'Jira had not rendered the issue yet.';

    while (Date.now() - started < timeoutMs) {
      if (detectDeadLinkPage()) {
        return {
          ready: false,
          errorCode: 'DEAD_LINK',
          message: `Jira displayed “Oops, you've found a dead link” while opening ${ticket}.`
        };
      }

      if (isAuthenticationPage(ticket)) {
        return {
          ready: false,
          errorCode: 'AUTH_REQUIRED',
          message: 'Jira authentication is required. Open Jira, sign in, and run the validator again.'
        };
      }

      const urlTicket = detectIssueKeyFromUrl();
      if (urlTicket && urlTicket !== String(ticket || '').toUpperCase()) {
        return {
          ready: false,
          errorCode: 'NAVIGATION_MISMATCH',
          message: `Expected ${ticket}, but Jira navigated to ${urlTicket}.`
        };
      }

      const complete = document.readyState === 'complete';
      const issueShell = Boolean(document.querySelector(
        '#issue-content, #summary-val, #key-val, #due-date, #customfield_16801-val, #customfield_14002-val'
      ));
      const duePresent = fieldPresent(settings.dueDateSelector, '#due-date');
      const livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');
      const issueTypeName = detectIssueTypeName();
      const aemPresent = fieldPresent(settings.aemPagePathSelector, '#customfield_14002-val');
      const aemRequired = !isAemOptionalIssueType(issueTypeName, settings);
      const fieldsReady = issueFieldsReady(
        settings,
        { duePresent, livePresent, aemPresent, aemRequired },
        requireIssueFields
      );
      const detectedTicket = detectIssueKey();
      const ticketMatches = !detectedTicket || detectedTicket === String(ticket || '').toUpperCase();
      const busy = hasBlockingPageLoader();

      if (complete && issueShell && fieldsReady && ticketMatches && !busy) {
        const signature = [
          location.href,
          document.title,
          detectedTicket,
          duePresent,
          livePresent,
          aemPresent,
          document.querySelectorAll('.editable-field.active').length
        ].join('|');

        stableSamples = signature === lastSignature ? stableSamples + 1 : 1;
        lastSignature = signature;

        if (stableSamples >= TIMING.STABLE_SAMPLE_COUNT) {
          const appState = await runMainWorldAction({ action: 'GET_PAGE_STATE', ticket });
          const mainWorldUnavailable = !appState.success;
          const appReady = mainWorldUnavailable || (
            appState.ready &&
            !appState.deadLink &&
            appState.issueShell &&
            (!appState.detectedTicket || appState.detectedTicket === String(ticket || '').toUpperCase()) &&
            (appState.ajsReady || appState.jiraReady)
          );

          if (appReady) {
            await sleep(TIMING.PAGE_QUIET_MS);
            if (!detectDeadLinkPage() && document.readyState === 'complete') {
              return { ready: true, errorCode: '', message: '' };
            }
          } else {
            lastReason = `Jira's application scripts were not ready yet (${appState.message || 'AJS/JIRA unavailable'}).`;
          }
        }
      } else {
        stableSamples = 0;
        lastSignature = '';
        if (!complete) lastReason = `Document state was ${document.readyState}.`;
        else if (busy) lastReason = 'Jira still displayed a blocking loading indicator.';
        else if (!issueShell) lastReason = 'The Jira issue shell was not present.';
        else if (!fieldsReady) {
          const liveRequired = settings.liveDateRequiredForRun === true;
          const dueRequired = settings.dueDateRequiredForRun === true;
          const optionalParts = [];
          if (!dueRequired) optionalParts.push('Due optional');
          if (!liveRequired) optionalParts.push('Live Date optional');
          const optionalSuffix = optionalParts.length ? ` (${optionalParts.join('; ')})` : '';
          const aemSuffix = aemRequired ? '' : ' AEM optional for this issue type';
          lastReason = `Waiting for required fields: Due=${duePresent}, Live Date=${livePresent}, AEM Page Path=${aemPresent}.${aemSuffix}${optionalSuffix}`;
        } else if (!ticketMatches) lastReason = `The rendered ticket did not match ${ticket}.`;
      }

      await sleep(TIMING.STABLE_POLL_MS);
    }

    return {
      ready: false,
      errorCode: 'PAGE_NOT_READY',
      message: `Jira did not become safe for automation within ${Math.ceil(timeoutMs / 1000)} seconds. ${lastReason}`
    };
  }

  Object.assign(Content, {
    waitForPage,
    detectDeadLinkPage,
    detectIssueKeyFromUrl,
    hasBlockingPageLoader,
    isAuthenticationPage,
    detectIssueKey,
    detectIssueTypeName
  });
})();
