'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../lib/dom-utils');
require('../lib/date-utils');

const {
  parseDate,
  validateDates,
  formatIsoDate,
  addUtcDays,
  extractDateToken,
  formatDueDateInputValue,
  formatLiveDateInputValue,
  shouldAttemptDueDateUpdate,
  resolveDateValidation
} = require('../lib/date-utils');

test('extractDateToken finds ISO and Jira-style dates', () => {
  assert.equal(extractDateToken('Due: 2026-08-14'), '2026-08-14');
  assert.equal(extractDateToken('14/Aug/26'), '14/Aug/26');
  assert.equal(extractDateToken('14/08/2026'), '14/08/2026');
});

test('parseDate handles ISO values', () => {
  const date = parseDate('2026-08-14', 'DMY');
  assert.equal(formatIsoDate(date), '2026-08-14');
});

test('parseDate respects DMY order for numeric dates', () => {
  const dmy = parseDate('14/08/2026', 'DMY');
  const mdy = parseDate('08/14/2026', 'MDY');
  assert.equal(formatIsoDate(dmy), '2026-08-14');
  assert.equal(formatIsoDate(mdy), '2026-08-14');
});

test('parseDate handles Jira short month format', () => {
  const date = parseDate('14/Aug/26', 'DMY');
  assert.equal(formatIsoDate(date), '2026-08-14');
});

test('validateDates passes when Due is exactly two days after Live Date', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 2);
  const result = validateDates(due, live, 'due_exactly_two_days_after_live');
  assert.equal(result.status, 'PASS');
  assert.equal(result.differenceInDays, 2);
});

test('validateDates fails when Due is one day after Live Date', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 1);
  const result = validateDates(due, live, 'due_exactly_two_days_after_live');
  assert.equal(result.status, 'FAIL');
  assert.equal(result.differenceInDays, 1);
});

test('shouldAttemptDueDateUpdate skips when Due already matches Live Date plus 2 days', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 2);
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(shouldAttemptDueDateUpdate(due, live, rule, true), false);
  assert.equal(validateDates(due, live, rule).status, 'PASS');
});

test('shouldAttemptDueDateUpdate allows repair when Due is one day after Live Date', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 1);
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(shouldAttemptDueDateUpdate(due, live, rule, true), true);
});

test('validateDates passes when Due is more than two days after Live Date', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 5);
  const result = validateDates(due, live, 'due_exactly_two_days_after_live');
  assert.equal(result.status, 'PASS');
  assert.equal(result.dueDateExact, false);
  assert.equal(result.differenceInDays, 5);
});

test('shouldAttemptDueDateUpdate skips when Due is later than Live Date plus 2 days', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 4);
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(shouldAttemptDueDateUpdate(due, live, rule, true), false);
  assert.equal(validateDates(due, live, rule).status, 'PASS');
});

test('shouldAttemptDueDateUpdate can pull late Due back when onlyWhenTooEarly is disabled', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 4);
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(
    shouldAttemptDueDateUpdate(due, live, rule, true, true, true, { autoUpdateDueDateOnlyWhenTooEarly: false }),
    true
  );
});

test('shouldAttemptDueDateUpdate does not run when Due is missing from the issue view', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(shouldAttemptDueDateUpdate(null, live, rule, true, false), false);
  assert.equal(shouldAttemptDueDateUpdate(null, live, rule, true, true), false);
});

test('resolveDateValidation returns SKIPPED when Due field is not on the issue view', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const result = resolveDateValidation(null, live, 'due_exactly_two_days_after_live', {
    duePresent: false,
    livePresent: true,
    skipDueValidationWhenMissing: true
  });
  assert.equal(result.status, 'SKIPPED');
});

test('resolveDateValidation returns SKIPPED when Live Date field is not on the issue view', () => {
  const due = parseDate('12/Aug/26', 'DMY');
  const result = resolveDateValidation(due, null, 'due_exactly_two_days_after_live', {
    duePresent: true,
    livePresent: false,
    skipLiveDateValidationWhenMissing: true
  });
  assert.equal(result.status, 'SKIPPED');
});

test('shouldAttemptDueDateUpdate does not run when Live Date field is missing from the issue view', () => {
  const due = parseDate('12/Aug/26', 'DMY');
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(shouldAttemptDueDateUpdate(due, null, rule, true, true, false), false);
});

test('resolveDateValidation returns SKIPPED when AEM Page Publish Time is on the issue view', () => {
  const due = parseDate('12/Aug/26', 'DMY');
  const live = parseDate('10/Aug/26', 'DMY');
  const result = resolveDateValidation(due, live, 'due_exactly_two_days_after_live', {
    duePresent: true,
    livePresent: false,
    publishTimePresent: true,
    skipDueRuleWhenPublishTimePresent: true
  });
  assert.equal(result.status, 'SKIPPED');
  assert.match(result.message, /AEM Page Publish Time/i);
});

test('resolveDateValidation uses history Live Date when field is missing', () => {
  const due = parseDate('03/Oct/26', 'DMY');
  const historyLive = parseDate('01/Oct/26', 'DMY');
  const result = resolveDateValidation(due, null, 'due_exactly_two_days_after_live', {
    duePresent: true,
    livePresent: false,
    skipLiveDateValidationWhenMissing: true,
    liveDateFromHistory: true,
    historyLiveDate: historyLive,
    historyLiveDateNote: 'READY FOR LIVE → LIVE'
  });
  assert.equal(result.status, 'PASS');
  assert.match(result.message, /issue history/i);
});

test('shouldAttemptDueDateUpdate runs when Live Date comes from issue history', () => {
  const due = parseDate('01/Oct/26', 'DMY');
  const live = parseDate('01/Oct/26', 'DMY');
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(
    shouldAttemptDueDateUpdate(due, live, rule, true, true, false, {
      liveDateFromHistory: true
    }),
    true
  );
});

test('shouldAttemptDueDateUpdate does not run when AEM Page Publish Time is on the issue view', () => {
  const due = parseDate('10/Aug/26', 'DMY');
  const live = parseDate('10/Aug/26', 'DMY');
  const rule = 'due_exactly_two_days_after_live';

  assert.equal(
    shouldAttemptDueDateUpdate(due, live, rule, true, true, true, {
      publishTimePresent: true,
      skipDueRuleWhenPublishTimePresent: true
    }),
    false
  );
});

test('validateDates returns ERROR for unsupported rules', () => {
  const live = parseDate('10/Aug/26', 'DMY');
  const due = addUtcDays(live, 2);
  const result = validateDates(due, live, 'unsupported_rule');
  assert.equal(result.status, 'ERROR');
});

test('formatDueDateInputValue prefers ISO when the input hints at yyyy-mm-dd', () => {
  const date = parseDate('2026-08-14', 'DMY');
  const formatted = formatDueDateInputValue(
    { value: '2026-01-01', placeholder: 'yyyy-mm-dd' },
    date,
    'DMY'
  );
  assert.equal(formatted, '2026-08-14');
});

test('formatLiveDateInputValue prefers history rawTimestamp when calendar day matches', () => {
  const date = parseDate('01/Oct/26', 'DMY');
  const formatted = formatLiveDateInputValue(
    { id: 'customfield_16801' },
    date,
    'DMY',
    { rawTimestamp: '01/Oct/26 6:31 PM' }
  );
  assert.equal(formatted, '01/Oct/26 6:31 PM');
});

test('formatLiveDateInputValue uses datetime hint when rawTimestamp is absent', () => {
  const date = parseDate('01/Oct/26', 'DMY');
  const formatted = formatLiveDateInputValue(
    {
      id: 'customfield_16801',
      closest: () => ({
        querySelector: () => ({ textContent: 'Use the dd/MMM/yy h:mm a date format.' })
      })
    },
    date,
    'DMY'
  );
  assert.equal(formatted, '01/Oct/26 12:00 PM');
});
