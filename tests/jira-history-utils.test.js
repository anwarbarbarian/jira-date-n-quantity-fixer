'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../lib/dom-utils');
require('../lib/date-utils');
require('../lib/jira-history-utils');

const { findReadyForLiveToLiveTransition } = require('../lib/jira-history-utils');

const SAMPLE_HISTORY = `
<div id="issue_actions_container">
  <div class="issue-data-block" id="changehistory-123626885">
    <div class="actionContainer">
      <div class="action-details">
        <span class="date" title="01/Oct/26 6:31 PM"><time datetime="2026-10-01T18:31:14+0530">01/Oct/26 6:31 PM</time></span>
      </div>
      <div class="changehistory action-body">
        <table><tbody>
          <tr>
            <td class="activity-name">Status</td>
            <td class="activity-old-val"><b>Original:</b> READY FOR LIVE <span class="hist-value">[12901]</span></td>
            <td class="activity-new-val"><b>New:</b> LIVE <span class="hist-value">[11320]</span></td>
          </tr>
        </tbody></table>
      </div>
    </div>
  </div>
</div>
`;

test('findReadyForLiveToLiveTransition reads READY FOR LIVE to LIVE from history markup', () => {
  const dom = new JSDOM(`<body>${SAMPLE_HISTORY}</body>`);
  const transition = findReadyForLiveToLiveTransition(dom.window.document, {
    fromStatus: 'READY FOR LIVE',
    toStatus: 'LIVE'
  });

  assert.ok(transition);
  assert.equal(transition.fromStatus, 'READY FOR LIVE');
  assert.equal(transition.toStatus, 'LIVE');
  assert.equal(transition.rawTimestamp, '01/Oct/26 6:31 PM');
  assert.equal(transition.date.getUTCFullYear(), 2026);
  assert.equal(transition.date.getUTCMonth() + 1, 10);
  assert.equal(transition.date.getUTCDate(), 1);
});
