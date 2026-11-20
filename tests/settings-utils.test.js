'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../lib/settings-utils');

const {
  DEFAULT_SETTINGS,
  COMPARISON_RULE,
  sanitiseSettings,
  parseTicketIds,
  selectorRoot,
  fieldPresent,
  issueFieldsReady,
  isAemOptionalIssueType,
  isQuantitySkippedIssueType,
  isDueDateSkippedIssueType,
  usesFixedQuantityWithoutAem,
  fixedQuantityForAemOptionalIssue,
  normaliseDetectedIssueTypeName,
  isAemPagePublishTimePresent,
  readAemPagePublishTimeValue,
  isTicketValidationSuccessful
} = require('../lib/settings-utils');

test('sanitiseSettings clamps timeout and preserves supported values', () => {
  const settings = sanitiseSettings({
    settingsVersion: 24,
    timeoutSeconds: 999,
    numericDateOrder: 'MDY',
    dueDateSelector: '#due-date time',
    liveDateSelector: '#customfield_16801-val time'
  });

  assert.equal(settings.timeoutSeconds, 180);
  assert.equal(settings.numericDateOrder, 'MDY');
  assert.equal(settings.comparisonRule, COMPARISON_RULE);
  assert.equal(settings.autoUpdateDueDateOnlyWhenTooEarly, true);
});

test('sanitiseSettings resets stale settings versions to defaults', () => {
  const settings = sanitiseSettings({
    settingsVersion: 1,
    dueDateSelector: '#custom due',
    timeoutSeconds: 10
  });

  assert.equal(settings.dueDateSelector, DEFAULT_SETTINGS.dueDateSelector);
  assert.equal(settings.timeoutSeconds, 60);
});

test('parseTicketIds deduplicates IDs and extracts browse URLs', () => {
  const ids = parseTicketIds(`
    abc-1
    ABC-1, DEF-2
    https://jira.secext.samsung.net/browse/GHI-3
    not-a-ticket
  `);

  assert.deepEqual(ids, ['ABC-1', 'DEF-2', 'GHI-3']);
});

test('selectorRoot returns the first selector segment', () => {
  assert.equal(selectorRoot('#due-date time'), '#due-date');
  assert.equal(selectorRoot('#customfield_14002-val'), '#customfield_14002-val');
});

test('issueFieldsReady allows missing Live Date when liveDateRequiredForRun is false', () => {
  const settings = sanitiseSettings({ settingsVersion: 24, liveDateRequiredForRun: false });
  assert.equal(
    issueFieldsReady(settings, { duePresent: true, livePresent: false, aemPresent: true }),
    true
  );
  assert.equal(
    issueFieldsReady(settings, { duePresent: true, livePresent: false, aemPresent: false, aemRequired: false }),
    true
  );
  assert.equal(
    issueFieldsReady(settings, { duePresent: true, livePresent: false, aemPresent: false, aemRequired: true }),
    false
  );
});

test('issueFieldsReady requires Live Date when liveDateRequiredForRun is true', () => {
  const settings = sanitiseSettings({ settingsVersion: 24, liveDateRequiredForRun: true });
  assert.equal(
    issueFieldsReady(settings, { duePresent: true, livePresent: false, aemPresent: true }),
    false
  );
  assert.equal(
    issueFieldsReady(settings, { duePresent: true, livePresent: true, aemPresent: true }),
    true
  );
});

test('issueFieldsReady allows missing Due when dueDateRequiredForRun is false', () => {
  const settings = sanitiseSettings({ settingsVersion: 24, dueDateRequiredForRun: false });
  assert.equal(
    issueFieldsReady(settings, { duePresent: false, livePresent: true, aemPresent: true }),
    true
  );
});

test('issueFieldsReady requires Due when dueDateRequiredForRun is true', () => {
  const settings = sanitiseSettings({ settingsVersion: 24, dueDateRequiredForRun: true });
  assert.equal(
    issueFieldsReady(settings, { duePresent: false, livePresent: true, aemPresent: true }),
    false
  );
});

test('issueFieldsReady allows missing AEM when aemRequired is false', () => {
  const settings = sanitiseSettings({ settingsVersion: 22 });
  assert.equal(
    issueFieldsReady(settings, { duePresent: true, livePresent: true, aemPresent: false, aemRequired: false }),
    true
  );
});

test('isAemOptionalIssueType matches Static Page WSC Production', () => {
  const settings = sanitiseSettings({ settingsVersion: 22 });
  assert.equal(isAemOptionalIssueType('Static Page WSC Production', settings), true);
  assert.equal(isAemOptionalIssueType('Other Issue Type', settings), false);
  assert.equal(fixedQuantityForAemOptionalIssue(settings), 1);
  assert.equal(usesFixedQuantityWithoutAem('Static Page WSC Production', settings), true);
  assert.equal(usesFixedQuantityWithoutAem('PDP Publishing Request', settings), false);
});

test('PDP Publishing Request skips AEM and Quantity rules', () => {
  const settings = sanitiseSettings({ settingsVersion: 22 });
  assert.equal(isQuantitySkippedIssueType('PDP Publishing Request', settings), true);
  assert.equal(isDueDateSkippedIssueType('PDP Publishing Request', settings), true);
  assert.equal(isAemOptionalIssueType('PDP Publishing Request', settings), true);
  assert.equal(usesFixedQuantityWithoutAem('PDP Publishing Request', settings), false);
});

test('PDP Publishing Request skips Due date rule and auto-update', () => {
  const settings = sanitiseSettings({ settingsVersion: 22 });
  const pdpTitle = 'PDP Publishing Request - To request publishing of a PDP';
  assert.equal(isDueDateSkippedIssueType(pdpTitle, settings), true);
  assert.equal(isDueDateSkippedIssueType('Other Issue Type', settings), false);
});

test('normaliseDetectedIssueTypeName strips Jira title suffix after dash', () => {
  assert.equal(
    normaliseDetectedIssueTypeName('PDP Publishing Request - To request publishing of a PDP'),
    'PDP Publishing Request'
  );
  assert.equal(
    normaliseDetectedIssueTypeName('Static Page WSC Production - To request publishing'),
    'Static Page WSC Production'
  );
});

test('issue type lists match Jira img title strings with description suffix', () => {
  const settings = sanitiseSettings({ settingsVersion: 22 });
  const pdpTitle = 'PDP Publishing Request - Long description from img[title]';
  assert.equal(isQuantitySkippedIssueType(pdpTitle, settings), true);
  assert.equal(isAemOptionalIssueType(pdpTitle, settings), true);
});

test('sanitiseSettings includes default gnb quantity label bonus', () => {
  const settings = sanitiseSettings({ settingsVersion: 22 });
  assert.deepEqual(settings.quantityLabelBonuses, [{ label: 'gnb', bonus: 1 }]);
  assert.equal(settings.issueLabelsSelector, '#wrap-labels .labels a.lozenge');
});

test('isAemPagePublishTimePresent is true when publish time has a value', () => {
  const settings = sanitiseSettings({ settingsVersion: 24 });
  const dom = new JSDOM('<div id="customfield_14005-val"><time>06/Oct/26</time></div>');
  global.document = dom.window.document;
  assert.equal(readAemPagePublishTimeValue(settings), '06/Oct/26');
  assert.equal(isAemPagePublishTimePresent(settings), true);
});

test('isAemPagePublishTimePresent is false when publish time field is empty', () => {
  const settings = sanitiseSettings({ settingsVersion: 24 });
  const dom = new JSDOM('<div id="customfield_14005-val"></div>');
  global.document = dom.window.document;
  assert.equal(isAemPagePublishTimePresent(settings), false);
});

test('fieldPresent checks selector roots and full selectors', () => {
  const dom = new JSDOM(`
    <div id="due-date"><time datetime="2026-08-14">14/Aug/26</time></div>
    <div id="customfield_16801-val"><time>12/Aug/26</time></div>
  `);
  global.document = dom.window.document;

  assert.equal(fieldPresent('#due-date time', '#due-date'), true);
  assert.equal(fieldPresent('#missing time', '#also-missing'), false);
});

test('sanitiseSettings includes resolution auto-update defaults', () => {
  const settings = sanitiseSettings({ settingsVersion: 24 });
  assert.equal(settings.autoUpdateResolutionOnSuccess, true);
  assert.equal(settings.resolutionCompletedValue, '10500');
  assert.equal(settings.resolutionSelectSelector, '#resolution');
  assert.equal(settings.autoUpdatePendingReasonOnSuccess, true);
  assert.equal(settings.pendingReasonOptionValue, '20102');
});

test('isTicketValidationSuccessful allows PASS and SKIPPED without failed updates', () => {
  assert.equal(isTicketValidationSuccessful({
    dateStatus: 'PASS',
    quantityStatus: 'PASS',
    dueUpdateAttempted: false,
    dueUpdateSuccess: false,
    quantityUpdateAttempted: true,
    quantityUpdateSuccess: true
  }), true);
  assert.equal(isTicketValidationSuccessful({
    dateStatus: 'SKIPPED',
    quantityStatus: 'PASS'
  }), true);
  assert.equal(isTicketValidationSuccessful({
    dateStatus: 'SKIPPED',
    quantityStatus: 'SKIPPED'
  }), false);
  assert.equal(isTicketValidationSuccessful({
    dateStatus: 'FAIL',
    quantityStatus: 'PASS'
  }), false);
  assert.equal(isTicketValidationSuccessful({
    dateStatus: 'PASS',
    quantityStatus: 'PASS',
    quantityUpdateAttempted: true,
    quantityUpdateSuccess: false
  }), false);
  assert.equal(isTicketValidationSuccessful({
    errorCode: 'PAGE_NOT_READY',
    dateStatus: 'ERROR',
    quantityStatus: 'ERROR'
  }), false);
});
