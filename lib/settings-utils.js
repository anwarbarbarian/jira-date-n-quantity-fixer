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
  const SETTINGS_VERSION = 21;
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
    fixedQuantityWithoutAem: 1,
    issueLabelsSelector: '#wrap-labels .labels a.lozenge',
    quantityLabelBonuses: Object.freeze([
      Object.freeze({ label: 'gnb', bonus: 1 })
    ]),
    useLiveDateFromStatusHistory: true,
    liveStatusTransitionFrom: 'READY FOR LIVE',
    liveStatusTransitionTo: 'LIVE',
    autoUpdateLiveDateFromHistory: true,
    maxHistoryLoadMoreClicks: 5
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
      )
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

  function isAemPagePublishTimePresent(settings = {}) {
    return fieldPresent(
      settings.aemPagePublishTimeSelector,
      '#customfield_14005-val'
    );
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
    issueFieldsReady,
    normaliseIssueTypeName,
    normaliseDetectedIssueTypeName,
    sanitiseIssueTypeList,
    sanitiseQuantityLabelBonuses,
    isAemOptionalIssueType,
    isQuantitySkippedIssueType,
    usesFixedQuantityWithoutAem,
    fixedQuantityForAemOptionalIssue
  };
});
