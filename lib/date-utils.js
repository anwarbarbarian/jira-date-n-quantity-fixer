'use strict';

(function attachDateUtils(root, factory) {
  const api = factory(root.JiraValidator || {});
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidator = root.JiraValidator || {};
    Object.assign(root.JiraValidator, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createDateUtils(deps) {
  const { normaliseText = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() } = deps;

  function extractDateToken(rawValue) {
    const value = normaliseText(rawValue || '');
    if (!value) return '';

    const patterns = [
      /\b\d{4}-\d{1,2}-\d{1,2}\b/,
      /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/,
      /\b\d{1,2}[\s/\-.]+[A-Za-z]{3,9}[\s/\-.]+\d{2,4}\b/,
      /\b[A-Za-z]{3,9}[\s/\-.]+\d{1,2}(?:st|nd|rd|th)?[,]?[\s/\-.]+\d{2,4}\b/i
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return match[0];
    }
    return '';
  }

  function monthNumber(value) {
    const key = value.slice(0, 3).toLowerCase();
    const months = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };
    return months[key] || 0;
  }

  function normaliseYear(year) {
    if (year >= 100) return year;
    return year <= 69 ? 2000 + year : 1900 + year;
  }

  function makeUtcDate(year, month, day) {
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function parseDate(rawValue, numericOrder) {
    const token = extractDateToken(rawValue);
    if (!token) return null;

    const value = token
      .trim()
      .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
      .replace(/,/g, '')
      .replace(/\s+/g, ' ');

    let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return makeUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));

    match = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      const year = normaliseYear(Number(match[3]));
      const day = numericOrder === 'MDY' ? second : first;
      const month = numericOrder === 'MDY' ? first : second;
      return makeUtcDate(year, month, day);
    }

    match = value.match(/^(\d{1,2})[\s/\-.]+([A-Za-z]{3,9})[\s/\-.]+(\d{2,4})$/);
    if (match) {
      return makeUtcDate(
        normaliseYear(Number(match[3])),
        monthNumber(match[2]),
        Number(match[1])
      );
    }

    match = value.match(/^([A-Za-z]{3,9})[\s/\-.]+(\d{1,2})[\s/\-.]+(\d{2,4})$/);
    if (match) {
      return makeUtcDate(
        normaliseYear(Number(match[3])),
        monthNumber(match[1]),
        Number(match[2])
      );
    }

    return null;
  }

  function formatIsoDate(date) {
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
  }

  function formatJiraDate(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getUTCDate());
    const month = months[date.getUTCMonth()];
    const year = String(date.getUTCFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  }

  function formatJiraDateTime(date, timePart = '12:00 PM') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = months[date.getUTCMonth()];
    const year = String(date.getUTCFullYear()).slice(-2);
    const time = normaliseText(timePart || '12:00 PM') || '12:00 PM';
    return `${day}/${month}/${year} ${time}`;
  }

  function extractTimeFromLiveTimestamp(rawValue) {
    const value = normaliseText(rawValue || '');
    const match = value.match(/\b(\d{1,2}:\d{2}\s*[AP]\.?M\.?)\b/i);
    if (!match) return '';
    return match[1].replace(/\./g, '').replace(/\s+/g, ' ').trim();
  }

  function formatLiveDateInputValue(input, date, numericOrder, options = {}) {
    const raw = normaliseText(options.rawTimestamp || '');
    if (raw) {
      const parsedRaw = parseDate(raw, numericOrder);
      if (parsedRaw && formatIsoDate(parsedRaw) === formatIsoDate(date)) {
        return raw;
      }
    }

    const descriptionEl = input?.closest?.('.field-group')?.querySelector('#customfield_16801-description')
      || (typeof document !== 'undefined' ? document.querySelector('#customfield_16801-description') : null);
    const description = normaliseText(descriptionEl?.textContent || '');
    const hints = normaliseText([
      input?.value,
      input?.placeholder,
      input?.getAttribute?.('data-date-format'),
      description
    ].filter(Boolean).join(' '));

    if (/h\s*:\s*mm\s*a/i.test(hints) || /dd\s*\/\s*MMM\s*\/\s*yy/i.test(hints)) {
      const timePart = extractTimeFromLiveTimestamp(raw) || '12:00 PM';
      return formatJiraDateTime(date, timePart);
    }

    return formatJiraDate(date);
  }

  function addUtcDays(date, days) {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days
    ));
  }

  function toUtcDayNumber(date) {
    return Math.floor(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    ) / (24 * 60 * 60 * 1000));
  }

  function validateDates(dueDate, liveDate, rule) {
    if (!dueDate && !liveDate) {
      return { status: 'ERROR', message: 'Neither Due nor Live Date could be parsed.' };
    }
    if (!dueDate) {
      return { status: 'ERROR', message: 'Due could not be parsed.' };
    }
    if (!liveDate) {
      return { status: 'ERROR', message: 'Live Date could not be parsed.' };
    }
    if (rule !== 'due_exactly_two_days_after_live') {
      return { status: 'ERROR', message: 'Unsupported date validation rule.' };
    }

    const dueDay = toUtcDayNumber(dueDate);
    const liveDay = toUtcDayNumber(liveDate);
    const differenceInDays = dueDay - liveDay;
    const requiredDueDate = addUtcDays(liveDate, 2);
    const requiredDueDateIso = formatIsoDate(requiredDueDate);

    if (differenceInDays >= 2) {
      const dueDateExact = differenceInDays === 2;
      return {
        status: 'PASS',
        differenceInDays,
        dueDateExact,
        message: dueDateExact
          ? 'PASS: Due is exactly 2 calendar days after Live Date.'
          : `PASS: Due is ${differenceInDays} calendar days after Live Date (at least 2 required).`
      };
    }

    return {
      status: 'FAIL',
      differenceInDays,
      dueDateExact: false,
      message: `FAIL: Due must be on or after ${requiredDueDateIso}, which is 2 calendar days after Live Date. Current difference: ${differenceInDays} day${Math.abs(differenceInDays) === 1 ? '' : 's'}.`
    };
  }

  function dueLiveDifferenceInDays(dueDate, liveDate) {
    if (!dueDate || !liveDate) return null;
    return toUtcDayNumber(dueDate) - toUtcDayNumber(liveDate);
  }

  function buildDueUpdateSkipState(liveDate) {
    return {
      attempted: false,
      success: false,
      status: 'NOT_NEEDED',
      targetDateIso: liveDate ? formatIsoDate(addUtcDays(liveDate, 2)) : '',
      submittedValue: '',
      message: 'Due already equals Live Date plus 2 calendar days.'
    };
  }

  function buildDueUpdateSkipStateWhenDueAlreadyLate(differenceInDays) {
    return {
      attempted: false,
      success: false,
      status: 'NOT_NEEDED',
      targetDateIso: '',
      submittedValue: '',
      message: `Due is already ${differenceInDays} calendar day${differenceInDays === 1 ? '' : 's'} after Live Date (at least 2 required); automatic update was not performed.`
    };
  }

  function buildDueUpdateNotApplicableState(message) {
    return {
      attempted: false,
      success: false,
      status: 'NOT_APPLICABLE',
      targetDateIso: '',
      submittedValue: '',
      message: message || 'Due date validation was not applicable for this issue.'
    };
  }

  const DUE_RULE_SKIPPED_PUBLISH_TIME_MESSAGE =
    'AEM Page Publish Time is on the issue view — Live Date plus 2 calendar days rule was not applied.';

  function resolveDateValidation(dueDate, liveDate, rule, options = {}) {
    const duePresent = options.duePresent !== false;
    const livePresent = options.livePresent !== false;
    const skipDueWhenMissing = options.skipDueValidationWhenMissing !== false;
    const skipLiveWhenMissing = options.skipLiveDateValidationWhenMissing !== false;
    const skipWhenPublishTime = options.skipDueRuleWhenPublishTimePresent !== false;

    if (options.publishTimePresent && skipWhenPublishTime) {
      return {
        status: 'SKIPPED',
        message: DUE_RULE_SKIPPED_PUBLISH_TIME_MESSAGE
      };
    }

    if (!duePresent && skipDueWhenMissing) {
      return {
        status: 'SKIPPED',
        message: 'Due field is not on the issue view — Live Date plus 2 calendar days rule was not applied.'
      };
    }

    const historyLiveDate = options.historyLiveDate || null;
    const liveDateFromHistory = options.liveDateFromHistory === true && historyLiveDate;
    const effectiveLiveDate = liveDate || historyLiveDate;

    if (!livePresent && !liveDateFromHistory && skipLiveWhenMissing) {
      return {
        status: 'SKIPPED',
        message: 'Live Date field is not on the issue view — Live Date plus 2 calendar days rule was not applied.'
      };
    }

    const validation = validateDates(dueDate, effectiveLiveDate, rule);
    if (liveDateFromHistory && validation.status !== 'ERROR') {
      return {
        ...validation,
        message: `${validation.message} Live Date was inferred from issue history (${options.historyLiveDateNote || 'READY FOR LIVE → LIVE'}).`
      };
    }
    return validation;
  }

  function shouldAttemptDueDateUpdate(
    dueDate,
    liveDate,
    rule,
    autoUpdateDueDate,
    duePresent = true,
    livePresent = true,
    options = {}
  ) {
    if (options.publishTimePresent && options.skipDueRuleWhenPublishTimePresent !== false) return false;
    const liveReady = livePresent || options.liveDateFromHistory === true;
    if (!autoUpdateDueDate || !duePresent || !liveReady) return false;
    if (!dueDate || !liveDate) return false;

    const differenceInDays = dueLiveDifferenceInDays(dueDate, liveDate);
    if (differenceInDays === null) return false;

    const onlyWhenTooEarly = options.autoUpdateDueDateOnlyWhenTooEarly !== false;
    if (onlyWhenTooEarly) {
      return differenceInDays < 2;
    }

    return differenceInDays !== 2;
  }

  function formatDueDateInputValue(input, date, numericOrder) {
    const hints = normaliseText([
      input?.value,
      input?.placeholder,
      input?.getAttribute?.('data-date-format'),
      input?.getAttribute?.('data-format'),
      input?.getAttribute?.('aria-label')
    ].filter(Boolean).join(' '));

    if (/yyyy\s*[-/]\s*mm\s*[-/]\s*dd/i.test(hints) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(input?.value || '')) {
      return formatIsoDate(date);
    }

    if (/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/.test(input?.value || '')) {
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const year = String(date.getUTCFullYear());
      return numericOrder === 'MDY'
        ? `${month}/${day}/${year}`
        : `${day}/${month}/${year}`;
    }

    return formatJiraDate(date);
  }

  return {
    extractDateToken,
    parseDate,
    formatIsoDate,
    formatJiraDate,
    addUtcDays,
    toUtcDayNumber,
    validateDates,
    buildDueUpdateSkipState,
    buildDueUpdateSkipStateWhenDueAlreadyLate,
    buildDueUpdateNotApplicableState,
    dueLiveDifferenceInDays,
    DUE_RULE_SKIPPED_PUBLISH_TIME_MESSAGE,
    resolveDateValidation,
    shouldAttemptDueDateUpdate,
    formatDueDateInputValue,
    formatLiveDateInputValue,
    formatJiraDateTime
  };
});
