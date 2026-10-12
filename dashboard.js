'use strict';

const STATE_KEY = 'jiraValidationState';
const { SETTINGS_VERSION, COMPARISON_RULE, parseTicketIds } = globalThis.JiraValidator;

const elements = {
  ticketInput: document.getElementById('ticketInput'),
  dueDateLabel: document.getElementById('dueDateLabel'),
  liveDateLabel: document.getElementById('liveDateLabel'),
  dueDateSelector: document.getElementById('dueDateSelector'),
  liveDateSelector: document.getElementById('liveDateSelector'),
  numericDateOrder: document.getElementById('numericDateOrder'),
  timeoutSeconds: document.getElementById('timeoutSeconds'),
  liveDateRequiredForRun: document.getElementById('liveDateRequiredForRun'),
  dueDateRequiredForRun: document.getElementById('dueDateRequiredForRun'),
  skipDueDateValidationWhenMissing: document.getElementById('skipDueDateValidationWhenMissing'),
  skipLiveDateValidationWhenMissing: document.getElementById('skipLiveDateValidationWhenMissing'),
  aemPagePublishTimeSelector: document.getElementById('aemPagePublishTimeSelector'),
  skipDueDateRuleWhenPublishTimePresent: document.getElementById('skipDueDateRuleWhenPublishTimePresent'),
  useLiveDateFromStatusHistory: document.getElementById('useLiveDateFromStatusHistory'),
  autoUpdateLiveDateFromHistory: document.getElementById('autoUpdateLiveDateFromHistory'),
  issueLabelsSelector: document.getElementById('issueLabelsSelector'),
  autoUpdateDueDate: document.getElementById('autoUpdateDueDate'),
  autoUpdateDueDateOnlyWhenTooEarly: document.getElementById('autoUpdateDueDateOnlyWhenTooEarly'),
  aemPagePathSelector: document.getElementById('aemPagePathSelector'),
  autoExpandAemPagePath: document.getElementById('autoExpandAemPagePath'),
  quantityViewSelector: document.getElementById('quantityViewSelector'),
  quantityInputSelector: document.getElementById('quantityInputSelector'),
  autoUpdateQuantity: document.getElementById('autoUpdateQuantity'),
  startButton: document.getElementById('startButton'),
  stopButton: document.getElementById('stopButton'),
  exportButton: document.getElementById('exportButton'),
  clearButton: document.getElementById('clearButton'),
  runBadge: document.getElementById('runBadge'),
  progressText: document.getElementById('progressText'),
  progressCount: document.getElementById('progressCount'),
  progressBar: document.getElementById('progressBar'),
  message: document.getElementById('message'),
  resultSummary: document.getElementById('resultSummary'),
  resultsBody: document.getElementById('resultsBody')
};

let ticketInputSaveTimer = null;

void initialise();

async function initialise() {
  elements.startButton.addEventListener('click', startValidation);
  elements.stopButton.addEventListener('click', stopValidation);
  elements.clearButton.addEventListener('click', clearResults);
  elements.exportButton.addEventListener('click', exportCsv);
  elements.ticketInput.addEventListener('input', scheduleTicketInputSave);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STATE_KEY]) {
      render(changes[STATE_KEY].newValue);
    }
  });

  const response = await sendMessage({ type: 'GET_STATE' });
  if (response.ok) render(response.state);
}

async function startValidation() {
  setMessage('');
  const tickets = parseTicketIds(elements.ticketInput.value);
  if (!tickets.length) {
    setMessage('Enter at least one valid Jira ticket ID, for example ABC-123.', true);
    return;
  }

  elements.startButton.disabled = true;
  const response = await sendMessage({
    type: 'START_VALIDATION',
    payload: {
      tickets,
      ticketInputText: elements.ticketInput.value,
      settings: readSettings()
    }
  });

  if (!response.ok) {
    elements.startButton.disabled = false;
    setMessage(response.error, true);
  }
}

async function stopValidation() {
  elements.stopButton.disabled = true;
  const response = await sendMessage({ type: 'STOP_VALIDATION' });
  if (!response.ok) setMessage(response.error, true);
}

async function clearResults() {
  const response = await sendMessage({ type: 'CLEAR_RESULTS' });
  if (!response.ok) setMessage(response.error, true);
}

function readSettings() {
  return {
    settingsVersion: SETTINGS_VERSION,
    dueDateLabel: elements.dueDateLabel.value,
    liveDateLabel: elements.liveDateLabel.value,
    dueDateSelector: elements.dueDateSelector.value,
    liveDateSelector: elements.liveDateSelector.value,
    comparisonRule: COMPARISON_RULE,
    numericDateOrder: elements.numericDateOrder.value,
    timeoutSeconds: Number(elements.timeoutSeconds.value),
    liveDateRequiredForRun: elements.liveDateRequiredForRun.checked,
    dueDateRequiredForRun: elements.dueDateRequiredForRun.checked,
    skipDueDateValidationWhenMissing: elements.skipDueDateValidationWhenMissing.checked,
    skipLiveDateValidationWhenMissing: elements.skipLiveDateValidationWhenMissing.checked,
    aemPagePublishTimeLabel: 'AEM Page Publish Time',
    aemPagePublishTimeSelector: elements.aemPagePublishTimeSelector.value,
    skipDueDateRuleWhenPublishTimePresent: elements.skipDueDateRuleWhenPublishTimePresent.checked,
    useLiveDateFromStatusHistory: elements.useLiveDateFromStatusHistory.checked,
    autoUpdateLiveDateFromHistory: elements.autoUpdateLiveDateFromHistory.checked,
    issueLabelsSelector: elements.issueLabelsSelector.value,
    autoUpdateDueDate: elements.autoUpdateDueDate.checked,
    autoUpdateDueDateOnlyWhenTooEarly: elements.autoUpdateDueDateOnlyWhenTooEarly.checked,
    aemPagePathLabel: 'AEM Page Path',
    aemPagePathSelector: elements.aemPagePathSelector.value,
    autoExpandAemPagePath: elements.autoExpandAemPagePath.checked,
    quantityLabel: 'Quantity',
    quantityViewSelector: elements.quantityViewSelector.value,
    quantityInputSelector: elements.quantityInputSelector.value,
    autoUpdateQuantity: elements.autoUpdateQuantity.checked
  };
}

function render(state) {
  const total = state.queue?.length || 0;
  const completed = state.results?.length || 0;
  const activeNumber = state.running && state.currentTicket ? state.currentIndex + 1 : completed;

  elements.progressBar.max = Math.max(total, 1);
  elements.progressBar.value = Math.min(completed, total || 1);
  elements.progressCount.textContent = `${completed} / ${total}`;
  elements.progressText.textContent = state.running
    ? `Processing ${state.currentTicket || `ticket ${activeNumber}`}`
    : state.completedAt
      ? 'Run complete'
      : 'Ready';
  setMessage(state.lastMessage || '');

  elements.startButton.disabled = Boolean(state.running);
  elements.stopButton.disabled = !state.running;
  elements.exportButton.disabled = completed === 0;
  elements.clearButton.disabled = state.running || completed === 0;
  renderTicketInput(state);

  renderBadge(state);
  renderResults(state.results || []);
  renderSettings(state);
}

function renderBadge(state) {
  elements.runBadge.className = 'badge';
  if (state.running) {
    elements.runBadge.textContent = 'Running';
    elements.runBadge.classList.add('running');
  } else if (state.stopRequested) {
    elements.runBadge.textContent = 'Stopped';
    elements.runBadge.classList.add('stopped');
  } else if (state.completedAt && state.results?.length) {
    elements.runBadge.textContent = 'Complete';
    elements.runBadge.classList.add('done');
  } else {
    elements.runBadge.textContent = 'Idle';
    elements.runBadge.classList.add('idle');
  }
}

function renderTicketInput(state) {
  elements.ticketInput.disabled = Boolean(state.running);

  let persisted = '';
  if (typeof state.ticketInputText === 'string') {
    persisted = state.ticketInputText;
  } else if (Array.isArray(state.queue) && state.queue.length) {
    persisted = state.queue.join('\n');
  }

  if (document.activeElement === elements.ticketInput) {
    return;
  }

  if (elements.ticketInput.value !== persisted) {
    elements.ticketInput.value = persisted;
  }
}

function scheduleTicketInputSave() {
  if (elements.ticketInput.disabled) return;
  clearTimeout(ticketInputSaveTimer);
  ticketInputSaveTimer = setTimeout(() => {
    void sendMessage({
      type: 'SAVE_TICKET_INPUT',
      payload: { ticketInputText: elements.ticketInput.value }
    });
  }, 400);
}

function renderSettings(state) {
  if (!state.settings || state.running) return;
  elements.dueDateLabel.value = state.settings.dueDateLabel || elements.dueDateLabel.value;
  elements.liveDateLabel.value = state.settings.liveDateLabel || elements.liveDateLabel.value;
  elements.dueDateSelector.value = state.settings.dueDateSelector || '';
  elements.liveDateSelector.value = state.settings.liveDateSelector || '';
  elements.numericDateOrder.value = state.settings.numericDateOrder || elements.numericDateOrder.value;
  elements.timeoutSeconds.value = state.settings.timeoutSeconds || elements.timeoutSeconds.value;
  elements.liveDateRequiredForRun.checked = state.settings.liveDateRequiredForRun === true;
  elements.dueDateRequiredForRun.checked = state.settings.dueDateRequiredForRun === true;
  elements.skipDueDateValidationWhenMissing.checked = state.settings.skipDueDateValidationWhenMissing !== false;
  elements.skipLiveDateValidationWhenMissing.checked = state.settings.skipLiveDateValidationWhenMissing !== false;
  elements.aemPagePublishTimeSelector.value = state.settings.aemPagePublishTimeSelector
    || elements.aemPagePublishTimeSelector.value;
  elements.skipDueDateRuleWhenPublishTimePresent.checked =
    state.settings.skipDueDateRuleWhenPublishTimePresent !== false;
  elements.useLiveDateFromStatusHistory.checked = state.settings.useLiveDateFromStatusHistory !== false;
  elements.autoUpdateLiveDateFromHistory.checked = state.settings.autoUpdateLiveDateFromHistory !== false;
  elements.issueLabelsSelector.value = state.settings.issueLabelsSelector
    || elements.issueLabelsSelector.value;
  elements.autoUpdateDueDate.checked = state.settings.autoUpdateDueDate !== false;
  elements.autoUpdateDueDateOnlyWhenTooEarly.checked = state.settings.autoUpdateDueDateOnlyWhenTooEarly !== false;
  elements.aemPagePathSelector.value = state.settings.aemPagePathSelector || elements.aemPagePathSelector.value;
  elements.autoExpandAemPagePath.checked = state.settings.autoExpandAemPagePath !== false;
  elements.quantityViewSelector.value = state.settings.quantityViewSelector || elements.quantityViewSelector.value;
  elements.quantityInputSelector.value = state.settings.quantityInputSelector || elements.quantityInputSelector.value;
  elements.autoUpdateQuantity.checked = state.settings.autoUpdateQuantity !== false;
}

function renderResults(results) {
  if (!results.length) {
    elements.resultsBody.innerHTML = '<tr class="empty-row"><td colspan="5">No results yet.</td></tr>';
    elements.resultSummary.textContent = '';
    return;
  }

  const passCount = results.filter((result) => result.dateStatus === 'PASS').length;
  const updatedCount = results.filter((result) => result.dueUpdateStatus === 'UPDATED').length;
  const failCount = results.filter((result) => result.dateStatus === 'FAIL').length;
  const errorCount = results.filter((result) => result.dateStatus === 'ERROR').length;
  const skippedCount = results.filter((result) => result.dateStatus === 'SKIPPED').length;
  const quantityUpdatedCount = results.filter((result) => result.quantityUpdateStatus === 'UPDATED').length;
  const quantityFailCount = results.filter((result) => result.quantityStatus === 'FAIL').length;
  const quantityErrorCount = results.filter((result) => result.quantityStatus === 'ERROR').length;
  const summaryParts = [`${passCount} date pass`];
  if (updatedCount) summaryParts.push(`${updatedCount} date updated`);
  if (failCount) summaryParts.push(`${failCount} date fail`);
  if (errorCount) summaryParts.push(`${errorCount} date error`);
  if (skippedCount) summaryParts.push(`${skippedCount} date skipped`);
  if (quantityUpdatedCount) summaryParts.push(`${quantityUpdatedCount} quantity updated`);
  if (quantityFailCount) summaryParts.push(`${quantityFailCount} quantity fail`);
  if (quantityErrorCount) summaryParts.push(`${quantityErrorCount} quantity error`);
  elements.resultSummary.textContent = summaryParts.join(' · ');

  elements.resultsBody.replaceChildren(...results.map((result) => {
    const row = document.createElement('tr');
    row.append(
      createTicketCell(result),
      createTextCell(result.dueDateIso || result.dueDateRaw || '—'),
      createTextCell(result.liveDateIso || result.liveDateRaw || '—'),
      createDateStatusCell(result),
      createQuantityCell(result)
    );
    return row;
  }));
}

function createDateStatusCell(result) {
  const status = result.dateStatus || 'ERROR';

  if (status === 'PASS') {
    let label = 'PASS';
    if (result.dueUpdateStatus === 'UPDATED') {
      label = 'PASS · UPDATED';
    } else if (result.dateDueExact === false) {
      label = 'PASS · ≥2d';
    }
    return createStatusCell('PASS', label);
  }

  if (status === 'FAIL') {
    return createStatusCell('FAIL', 'FAIL');
  }

  if (status === 'SKIPPED') {
    return createStatusCell('SKIPPED', 'SKIPPED');
  }

  return createStatusCell('ERROR', 'ERROR');
}

function createQuantityCell(result) {
  const status = result.quantityStatus || 'ERROR';
  const actual = Number.isSafeInteger(result.quantity) ? result.quantity : null;
  const original = Number.isSafeInteger(result.originalQuantity) ? result.originalQuantity : null;
  const expected = Number.isSafeInteger(result.quantityExpected) && result.quantityExpected > 0
    ? result.quantityExpected
    : Number.isSafeInteger(result.aemPagePathCount) && result.aemPagePathCount > 0
      ? result.aemPagePathCount
      : null;

  if (status === 'PASS') {
    const value = actual ?? expected ?? '—';
    const label = result.quantityUpdateStatus === 'UPDATED'
      ? `${value} · UPDATED`
      : `${value} · PASS`;
    return createStatusCell('PASS', label);
  }

  if (status === 'FAIL') {
    const displayedActual = actual ?? original ?? '—';
    const label = expected === null
      ? `${displayedActual} · FAIL`
      : `${displayedActual} / ${expected} · FAIL`;
    return createStatusCell('FAIL', label);
  }

  if (status === 'SKIPPED') {
    return createStatusCell('SKIPPED', 'SKIPPED');
  }

  return createStatusCell('ERROR', expected === null ? 'ERROR' : `Expected ${expected} · ERROR`);
}

function createTicketCell(result) {
  const cell = document.createElement('td');
  const link = document.createElement('a');
  link.href = result.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = result.ticket;
  cell.append(link);
  return cell;
}

function createTextCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function createStatusCell(status, label = status) {
  const cell = document.createElement('td');
  const pill = document.createElement('span');
  pill.className = `status-pill status-${statusClass(status)}`;
  pill.textContent = label;
  cell.append(pill);
  return cell;
}

async function exportCsv() {
  const response = await sendMessage({ type: 'GET_STATE' });
  if (!response.ok || !response.state.results?.length) return;

  const headers = [
    'Ticket', 'URL', 'Detected Issue Key', 'Original Due Raw', 'Original Due ISO',
    'Final Due Raw', 'Final Due ISO', 'Live Date Raw', 'Live Date ISO',
    'Date Status', 'Comparison Rule', 'Due Update Attempted', 'Due Update Success',
    'Due Update Status', 'Due Update Target ISO', 'Due Update Submitted Value',
    'Due Update Message', 'Date Message', 'Issue Labels', 'AEM Page Path Count', 'Quantity Label Bonus',
    'Quantity Expected', 'AEM Page Paths',
    'Original Quantity Raw', 'Original Quantity', 'Final Quantity Raw', 'Final Quantity',
    'Quantity Status', 'Quantity Message', 'Quantity Update Attempted', 'Quantity Update Success',
    'Quantity Update Status', 'Quantity Update Target', 'Quantity Update Submitted Value',
    'Quantity Update Message', 'Field Extraction Notes', 'Error Code', 'Error Message', 'Processed At'
  ];

  const rows = response.state.results.map((result) => [
    result.ticket,
    result.url,
    result.detectedIssueKey,
    result.originalDueDateRaw,
    result.originalDueDateIso,
    result.dueDateRaw,
    result.dueDateIso,
    result.liveDateRaw,
    result.liveDateIso,
    result.dateStatus,
    result.comparisonRule,
    result.dueUpdateAttempted ? 'Yes' : 'No',
    result.dueUpdateSuccess ? 'Yes' : 'No',
    result.dueUpdateStatus,
    result.dueUpdateTargetIso,
    result.dueUpdateSubmittedValue,
    result.dueUpdateMessage,
    result.dateMessage,
    Array.isArray(result.issueLabels) ? result.issueLabels.join(', ') : '',
    result.aemPagePathCount,
    result.quantityLabelBonus ?? 0,
    result.quantityExpected ?? '',
    Array.isArray(result.aemPagePathLines) ? result.aemPagePathLines.join('\n') : '',
    result.originalQuantityRaw,
    result.originalQuantity,
    result.quantityRaw,
    result.quantity,
    result.quantityStatus,
    result.quantityMessage,
    result.quantityUpdateAttempted ? 'Yes' : 'No',
    result.quantityUpdateSuccess ? 'Yes' : 'No',
    result.quantityUpdateStatus,
    result.quantityUpdateTarget,
    result.quantityUpdateSubmittedValue,
    result.quantityUpdateMessage,
    result.fieldExtractionNotes,
    result.errorCode,
    result.errorMessage,
    result.processedAt
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `jira-date-quantity-validation-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'pass') return 'pass';
  if (value === 'fail') return 'fail';
  if (value === 'error') return 'error';
  if (value === 'skipped') return 'neutral';
  return 'neutral';
}

function setMessage(message, isError = false) {
  elements.message.textContent = message || '';
  elements.message.classList.toggle('error', isError);
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
