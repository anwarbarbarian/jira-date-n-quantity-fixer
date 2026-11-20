'use strict';

(function attachSettingsUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidator = root.JiraValidator || {};
    Object.assign(root.JiraValidator, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createSettingsUtils() {
  const SETTINGS_VERSION = 24;
  const COMPARISON_RULE = 'due_exactly_two_days_after_live';

  const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: SETTINGS_VERSION,
    dueDateLabel: 'Due',
    liveDateLabel: 'Live Date',
    dueDateSelector: '#due-date time',
    liveDateSelector: '#customfield_16801-val time',
    aemPagePublishTimeLabel: 'AEM Page Publish Time',
    aemPagePublishTimeSelector: '#customfield_14005-val',
    skipDueDateRuleWhenPublishTimePresent: true,
    comparisonRule: COMPARISON_RULE,
    numericDateOrder: 'DMY',
    timeoutSeconds: 60,
    autoUpdateDueDate: true,
    autoUpdateDueDateOnlyWhenTooEarly: true,
    aemPagePathLabel: 'AEM Page Path',
    aemPagePathSelector: '#customfield_14002-val .twixi-wrap .flooded',
    autoExpandAemPagePath: true,
    quantityLabel: 'Quantity',
    quantityViewSelector: '#customfield_13618-val',
    quantityInputSelector: '#customfield_13618',
    autoUpdateQuantity: true,
    liveDateRequiredForRun: false,
    dueDateRequiredForRun: false,
    skipDueDateValidationWhenMissing: true,
    skipLiveDateValidationWhenMissing: true,
    aemOptionalIssueTypes: Object.freeze(['Static Page WSC Production']),
    quantitySkippedIssueTypes: Object.freeze(['PDP Publishing Request']),
    dueDateSkippedIssueTypes: Object.freeze(['PDP Publishing Request']),
    fixedQuantityWithoutAem: 1,
    issueLabelsSelector: '#wrap-labels .labels a.lozenge',
    quantityLabelBonuses: Object.freeze([
      Object.freeze({ label: 'gnb', bonus: 1 })
    ]),
    useLiveDateFromStatusHistory: true,
    liveStatusTransitionFrom: 'READY FOR LIVE',
    liveStatusTransitionTo: 'LIVE',
    autoUpdateLiveDateFromHistory: true,
    maxHistoryLoadMoreClicks: 5,
    autoUpdateResolutionOnSuccess: true,
    resolutionSelectSelector: '#resolution',
    resolutionViewSelector: '#resolution-val',
    resolutionCompletedValue: '10500',
    resolutionCompletedLabel: 'Completed',
    autoUpdatePendingReasonOnSuccess: true,
    pendingReasonFieldsetSelector: '#customfield_16802',
    pendingReasonCheckboxSelector: '#customfield_16802-1',
    pendingReasonOptionValue: '20102',
    pendingReasonOptionLabel: 'This ticket is not pending',
    pendingReasonViewSelector: '#customfield_16802-val'
  });

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function sanitiseSettings(settings = {}) {
    const allowedOrders = new Set(['DMY', 'MDY']);
    const isCurrentSettings = Number(settings.settingsVersion) === SETTINGS_VERSION;
    const source = isCurrentSettings ? settings : DEFAULT_SETTINGS;

    return {
      settingsVersion: SETTINGS_VERSION,
      dueDateLabel: String(source.dueDateLabel || DEFAULT_SETTINGS.dueDateLabel).trim(),
      liveDateLabel: String(source.liveDateLabel || DEFAULT_SETTINGS.liveDateLabel).trim(),
      dueDateSelector: String(source.dueDateSelector || DEFAULT_SETTINGS.dueDateSelector).trim().slice(0, 500),
      liveDateSelector: String(source.liveDateSelector || DEFAULT_SETTINGS.liveDateSelector).trim().slice(0, 500),
      aemPagePublishTimeLabel: String(
        source.aemPagePublishTimeLabel || DEFAULT_SETTINGS.aemPagePublishTimeLabel
      ).trim(),
      aemPagePublishTimeSelector: String(
        source.aemPagePublishTimeSelector || DEFAULT_SETTINGS.aemPagePublishTimeSelector
      ).trim().slice(0, 500),
      skipDueDateRuleWhenPublishTimePresent: source.skipDueDateRuleWhenPublishTimePresent !== false,
      comparisonRule: COMPARISON_RULE,
      numericDateOrder: allowedOrders.has(source.numericDateOrder)
        ? source.numericDateOrder
        : DEFAULT_SETTINGS.numericDateOrder,
      timeoutSeconds: clampNumber(
        source.timeoutSeconds,
        30,
        180,
        DEFAULT_SETTINGS.timeoutSeconds
      ),
      autoUpdateDueDate: source.autoUpdateDueDate !== false,
      autoUpdateDueDateOnlyWhenTooEarly: source.autoUpdateDueDateOnlyWhenTooEarly !== false,
      aemPagePathLabel: String(source.aemPagePathLabel || DEFAULT_SETTINGS.aemPagePathLabel).trim(),
      aemPagePathSelector: String(source.aemPagePathSelector || DEFAULT_SETTINGS.aemPagePathSelector).trim().slice(0, 500),
      quantityLabel: String(source.quantityLabel || DEFAULT_SETTINGS.quantityLabel).trim(),
      quantityViewSelector: String(source.quantityViewSelector || DEFAULT_SETTINGS.quantityViewSelector).trim().slice(0, 500),
      quantityInputSelector: String(source.quantityInputSelector || DEFAULT_SETTINGS.quantityInputSelector).trim().slice(0, 500),
      autoUpdateQuantity: source.autoUpdateQuantity !== false,
      liveDateRequiredForRun: source.liveDateRequiredForRun === true,
      dueDateRequiredForRun: source.dueDateRequiredForRun === true,
      skipDueDateValidationWhenMissing: source.skipDueDateValidationWhenMissing !== false,
      skipLiveDateValidationWhenMissing: source.skipLiveDateValidationWhenMissing !== false,
      autoExpandAemPagePath: source.autoExpandAemPagePath !== false,
      aemOptionalIssueTypes: sanitiseIssueTypeList(source.aemOptionalIssueTypes),
      quantitySkippedIssueTypes: sanitiseIssueTypeList(
        source.quantitySkippedIssueTypes,
        DEFAULT_SETTINGS.quantitySkippedIssueTypes
      ),
      dueDateSkippedIssueTypes: sanitiseIssueTypeList(
        source.dueDateSkippedIssueTypes,
        DEFAULT_SETTINGS.dueDateSkippedIssueTypes
      ),
      fixedQuantityWithoutAem: clampNumber(
        source.fixedQuantityWithoutAem,
        1,
        9999,
        DEFAULT_SETTINGS.fixedQuantityWithoutAem
      ),
      issueLabelsSelector: String(
        source.issueLabelsSelector || DEFAULT_SETTINGS.issueLabelsSelector
      ).trim().slice(0, 500),
      quantityLabelBonuses: sanitiseQuantityLabelBonuses(source.quantityLabelBonuses),
      useLiveDateFromStatusHistory: source.useLiveDateFromStatusHistory !== false,
      liveStatusTransitionFrom: String(
        source.liveStatusTransitionFrom || DEFAULT_SETTINGS.liveStatusTransitionFrom
      ).trim(),
      liveStatusTransitionTo: String(
        source.liveStatusTransitionTo || DEFAULT_SETTINGS.liveStatusTransitionTo
      ).trim(),
      autoUpdateLiveDateFromHistory: source.autoUpdateLiveDateFromHistory !== false,
      maxHistoryLoadMoreClicks: clampNumber(
        source.maxHistoryLoadMoreClicks,
        0,
        20,
        DEFAULT_SETTINGS.maxHistoryLoadMoreClicks
      ),
      autoUpdateResolutionOnSuccess: source.autoUpdateResolutionOnSuccess !== false,
      resolutionSelectSelector: String(
        source.resolutionSelectSelector || DEFAULT_SETTINGS.resolutionSelectSelector
      ).trim().slice(0, 500),
      resolutionViewSelector: String(
        source.resolutionViewSelector || DEFAULT_SETTINGS.resolutionViewSelector
      ).trim().slice(0, 500),
      resolutionCompletedValue: String(
        source.resolutionCompletedValue || DEFAULT_SETTINGS.resolutionCompletedValue
      ).trim().slice(0, 50),
      resolutionCompletedLabel: String(
        source.resolutionCompletedLabel || DEFAULT_SETTINGS.resolutionCompletedLabel
      ).trim().slice(0, 200),
      autoUpdatePendingReasonOnSuccess: source.autoUpdatePendingReasonOnSuccess !== false,
      pendingReasonFieldsetSelector: String(
        source.pendingReasonFieldsetSelector || DEFAULT_SETTINGS.pendingReasonFieldsetSelector
      ).trim().slice(0, 500),
      pendingReasonCheckboxSelector: String(
        source.pendingReasonCheckboxSelector || DEFAULT_SETTINGS.pendingReasonCheckboxSelector
      ).trim().slice(0, 500),
      pendingReasonOptionValue: String(
        source.pendingReasonOptionValue || DEFAULT_SETTINGS.pendingReasonOptionValue
      ).trim().slice(0, 50),
      pendingReasonOptionLabel: String(
        source.pendingReasonOptionLabel || DEFAULT_SETTINGS.pendingReasonOptionLabel
      ).trim().slice(0, 300),
      pendingReasonViewSelector: String(
        source.pendingReasonViewSelector || DEFAULT_SETTINGS.pendingReasonViewSelector
      ).trim().slice(0, 500)
    };
  }

  function normaliseIssueTypeName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normaliseDetectedIssueTypeName(value) {
    let text = normaliseIssueTypeName(value);
    if (!text) return '';
    const dashSuffix = text.indexOf(' - ');
    if (dashSuffix > 0) {
      const withoutDescription = text.slice(0, dashSuffix).trim();
      if (withoutDescription) text = withoutDescription;
    }
    return text;
  }

  function sanitiseQuantityLabelBonuses(value, fallbackList = DEFAULT_SETTINGS.quantityLabelBonuses) {
    const rawItems = Array.isArray(value) ? value : [];
    const seen = new Set();
    const items = [];
    for (const entry of rawItems) {
      const label = normaliseIssueTypeName(entry?.label ?? entry?.name);
      const bonus = clampNumber(entry?.bonus, 0, 99, 0);
      if (!label || bonus <= 0) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label, bonus });
    }
    return items.length ? items : fallbackList.map((item) => ({ ...item }));
  }

  function sanitiseIssueTypeList(value, fallbackList = DEFAULT_SETTINGS.aemOptionalIssueTypes) {
    const rawItems = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,;]+/);
    const seen = new Set();
    const items = [];
    for (const item of rawItems) {
      const normalised = normaliseIssueTypeName(item);
      if (!normalised) continue;
      const key = normalised.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(normalised);
    }
    return items.length ? items : [...fallbackList];
  }

  function issueTypeMatchesList(issueTypeName, list) {
    const issueType = normaliseDetectedIssueTypeName(issueTypeName).toLowerCase();
    if (!issueType) return false;
    return list.some((entry) => entry.toLowerCase() === issueType);
  }

  function isQuantitySkippedIssueType(issueTypeName, settings = {}) {
    const list = sanitiseIssueTypeList(
      settings.quantitySkippedIssueTypes,
      DEFAULT_SETTINGS.quantitySkippedIssueTypes
    );
    return issueTypeMatchesList(issueTypeName, list);
  }

  function isDueDateSkippedIssueType(issueTypeName, settings = {}) {
    const list = sanitiseIssueTypeList(
      settings.dueDateSkippedIssueTypes,
      DEFAULT_SETTINGS.dueDateSkippedIssueTypes
    );
    return issueTypeMatchesList(issueTypeName, list);
  }

  function isAemOptionalIssueType(issueTypeName, settings = {}) {
    if (isQuantitySkippedIssueType(issueTypeName, settings)) return true;
    const list = sanitiseIssueTypeList(settings.aemOptionalIssueTypes);
    return issueTypeMatchesList(issueTypeName, list);
  }

  function usesFixedQuantityWithoutAem(issueTypeName, settings = {}) {
    return isAemOptionalIssueType(issueTypeName, settings)
      && !isQuantitySkippedIssueType(issueTypeName, settings);
  }

  function fixedQuantityForAemOptionalIssue(settings = {}) {
    return clampNumber(
      settings.fixedQuantityWithoutAem,
      1,
      9999,
      DEFAULT_SETTINGS.fixedQuantityWithoutAem
    );
  }

  function issueFieldsReady(settings, fields, requireIssueFields = true) {
    if (!requireIssueFields) return true;

    const duePresent = Boolean(fields.duePresent);
    const livePresent = Boolean(fields.livePresent);
    const aemPresent = Boolean(fields.aemPresent);
    const aemRequired = fields.aemRequired !== false;
    const requireLiveDate = settings.liveDateRequiredForRun === true;
    const requireDueDate = settings.dueDateRequiredForRun === true;

    if (aemRequired && !aemPresent) return false;
    if (requireDueDate && !duePresent) return false;
    if (requireLiveDate && !livePresent) return false;
    return true;
  }

  function parseTicketIds(raw) {
    const tokens = String(raw || '')
      .split(/[\s,;]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const ids = [];
    const seen = new Set();
    for (const token of tokens) {
      const urlMatch = token.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
      const candidate = (urlMatch?.[1] || token).toUpperCase();
      if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(candidate)) continue;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        ids.push(candidate);
      }
    }
    return ids;
  }

  function selectorRoot(selector) {
    const trimmed = String(selector || '').trim();
    if (!trimmed) return '';
    const spaceIndex = trimmed.indexOf(' ');
    return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  }

  const SCHEDULED_PUBLISH_TIME_CLOSURE_MESSAGE =
    'Scheduled ticket (AEM Page Publish Time has a value) — Resolution and Pending Reason were not updated.';

  function normaliseFieldText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isPlaceholderPublishTimeValue(text) {
    const sample = normaliseFieldText(text).toLowerCase();
    if (!sample) return true;
    return /^(none|unscheduled|n\/a|na|—|-|–)$/.test(sample);
  }

  function readAemPagePublishTimeValue(settings = {}) {
    const selectors = [
      settings.aemPagePublishTimeSelector,
      '#customfield_14005-val'
    ].filter(Boolean);
    const seen = new Set();
    for (const selector of selectors) {
      const key = selector.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const element = document.querySelector(selector);
        if (!element) continue;
        const timeElement = element.querySelector('time');
        if (timeElement) {
          const token = normaliseFieldText(
            timeElement.getAttribute('datetime') || timeElement.textContent || timeElement.innerText
          );
          if (token && !isPlaceholderPublishTimeValue(token)) return token;
        }
        const text = normaliseFieldText(element.textContent || element.innerText || '');
        if (text && !isPlaceholderPublishTimeValue(text)) return text;
      } catch {
        continue;
      }
    }
    return '';
  }

  function isAemPagePublishTimePresent(settings = {}) {
    return Boolean(readAemPagePublishTimeValue(settings));
  }

  function isScheduledPublishTicket(settings = {}) {
    return isAemPagePublishTimePresent(settings);
  }

  function isTicketValidationSuccessful(outcome = {}) {
    if (outcome.errorCode) return false;
    const okStatuses = new Set(['PASS', 'SKIPPED']);
    if (!okStatuses.has(outcome.dateStatus)) return false;
    if (!okStatuses.has(outcome.quantityStatus)) return false;
    if (outcome.dateStatus === 'SKIPPED' && outcome.quantityStatus === 'SKIPPED') return false;
    if (outcome.liveUpdateAttempted && !outcome.liveUpdateSuccess) return false;
    if (outcome.dueUpdateAttempted && !outcome.dueUpdateSuccess) return false;
    if (outcome.quantityUpdateAttempted && !outcome.quantityUpdateSuccess) return false;
    return true;
  }

  function fieldPresent(selector, fallbackSelector) {
    const candidates = [selector, fallbackSelector].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (document.querySelector(candidate)) return true;
        const root = selectorRoot(candidate);
        if (root && root !== candidate && document.querySelector(root)) return true;
      } catch {
        // Invalid selector; try the next candidate.
      }
    }
    return false;
  }

  return {
    SETTINGS_VERSION,
    COMPARISON_RULE,
    DEFAULT_SETTINGS,
    clampNumber,
    sanitiseSettings,
    parseTicketIds,
    selectorRoot,
    fieldPresent,
    isAemPagePublishTimePresent,
    isScheduledPublishTicket,
    readAemPagePublishTimeValue,
    SCHEDULED_PUBLISH_TIME_CLOSURE_MESSAGE,
    issueFieldsReady,
    normaliseIssueTypeName,
    normaliseDetectedIssueTypeName,
    sanitiseIssueTypeList,
    sanitiseQuantityLabelBonuses,
    isAemOptionalIssueType,
    isQuantitySkippedIssueType,
    isDueDateSkippedIssueType,
    usesFixedQuantityWithoutAem,
    fixedQuantityForAemOptionalIssue,
    isTicketValidationSuccessful
  };
});
