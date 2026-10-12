'use strict';

(function attachJiraHistoryUtils(root, factory) {
  const api = factory(root.JiraValidator || {});
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidator = root.JiraValidator || {};
    Object.assign(root.JiraValidator, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createJiraHistoryUtils(deps) {
  const { normaliseText = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() } = deps;
  const { parseDate, extractDateToken } = deps;

  function utcDateFromInstant(instant) {
    return new Date(Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate()
    ));
  }

  function normaliseStatusName(value) {
    return normaliseText(value).replace(/\s+/g, ' ').toUpperCase();
  }

  function extractHistoryCellStatusText(cell) {
    if (!cell) return '';
    const clone = cell.cloneNode(true);
    for (const hidden of clone.querySelectorAll('.hist-value')) {
      hidden.remove();
    }
    let text = normaliseText(clone.textContent || '');
    text = text.replace(/^(?:Original|New):\s*/i, '').trim();
    return text;
  }

  function parseHistoryBlockTimestamp(block) {
    if (!block) return { date: null, raw: '', iso: '' };

    const timeElement = block.querySelector('.action-details time[datetime], .date time[datetime]');
    const datetime = timeElement?.getAttribute('datetime') || '';
    if (datetime) {
      const parsedMs = Date.parse(datetime);
      if (Number.isFinite(parsedMs)) {
        const instant = new Date(parsedMs);
        const date = utcDateFromInstant(instant);
        if (date) {
          return {
            date,
            raw: normaliseText(timeElement.textContent || datetime),
            iso: datetime
          };
        }
      }
    }

    const title = block.querySelector('.action-details .date[title]')?.getAttribute('title') || '';
    const token = extractDateToken(title || normaliseText(block.querySelector('.action-details .date')?.textContent || ''));
    if (token && parseDate) {
      const date = parseDate(token, 'DMY');
      if (date) {
        return { date, raw: token, iso: '' };
      }
    }

    return { date: null, raw: '', iso: '' };
  }

  function findReadyForLiveToLiveTransition(root, options = {}) {
    const fromStatus = normaliseStatusName(options.fromStatus || 'READY FOR LIVE');
    const toStatus = normaliseStatusName(options.toStatus || 'LIVE');
    if (!root || typeof root.querySelectorAll !== 'function') {
      return null;
    }

    const blocks = root.querySelectorAll(
      '#issue_actions_container .issue-data-block, #changehistory-tabpanel-tabpanel .issue-data-block, .issue-data-block'
    );

    for (const block of blocks) {
      for (const row of block.querySelectorAll('tr')) {
        const fieldName = normaliseText(row.querySelector('.activity-name')?.textContent || '');
        if (fieldName.toLowerCase() !== 'status') continue;

        const oldStatus = normaliseStatusName(extractHistoryCellStatusText(row.querySelector('.activity-old-val')));
        const newStatus = normaliseStatusName(extractHistoryCellStatusText(row.querySelector('.activity-new-val')));
        if (oldStatus !== fromStatus || newStatus !== toStatus) continue;

        const timestamp = parseHistoryBlockTimestamp(block);
        if (!timestamp.date) continue;

        return {
          date: timestamp.date,
          rawTimestamp: timestamp.raw,
          isoTimestamp: timestamp.iso,
          fromStatus: oldStatus,
          toStatus: newStatus
        };
      }
    }

    return null;
  }

  return {
    normaliseStatusName,
    extractHistoryCellStatusText,
    parseHistoryBlockTimestamp,
    findReadyForLiveToLiveTransition
  };
});
