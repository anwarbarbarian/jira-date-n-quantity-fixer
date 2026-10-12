'use strict';

(() => {
  const Content = globalThis.JiraValidatorContent = globalThis.JiraValidatorContent || {};
  const JV = globalThis.JiraValidator;
  const {
    sleep,
    normaliseText,
    runMainWorldAction,
    setInputValue,
    dispatchUserLikeClick,
    activateWithKeyboard,
    describeElement,
    blurInputAndFocusPage,
    getSearchRoots,
    isInsideEditIssueContainer,
    findControlInRoots,
    TIMING
  } = Content;
  const {
    parseDate,
    formatIsoDate,
    formatDueDateInputValue,
    formatLiveDateInputValue,
    buildDueUpdateSkipStateWhenDueAlreadyLate,
    shouldAttemptDueDateUpdate,
    dueLiveDifferenceInDays,
    fieldPresent,
    isAemPagePublishTimePresent,
    DUE_RULE_SKIPPED_PUBLISH_TIME_MESSAGE,
    parseQuantity
  } = JV;

  async function updateQuantityViaUi(expectedQuantity, settings, ticket) {
    const target = String(expectedQuantity);
    const readiness = await Content.waitForPage(ticket, 15000, { requireIssueFields: true, settings });
    if (!readiness.ready) {
      return failedQuantityUpdate(expectedQuantity, '', `Jira was not ready before opening Edit Issue. ${readiness.message}`);
    }

    let input = findQuantityInput(settings, 'dialog');
    let openedDialog = Boolean(input);

    if (!input) {
      const editControl = findEditIssueControl();
      if (!editControl) {
        return failedQuantityUpdate(expectedQuantity, '', 'The Jira Edit Issue control was not found in the issue operations area.');
      }
      dispatchUserLikeClick(editControl, { preventAnchorNavigation: true });
      openedDialog = true;
      input = await waitForQuantityInput(settings, 15000, 'dialog');
    }

    if (!input) {
      return failedQuantityUpdate(
        expectedQuantity,
        '',
        'The Edit Issue screen opened, but Quantity input #customfield_13618 was not found inside the active edit form.'
      );
    }

    const existingRaw = String(input.value || '').trim();
    const existingQuantity = parseQuantity(existingRaw);
    if (existingQuantity === expectedQuantity) {
      if (openedDialog) await cancelEditIssueDialog(input);
      return {
        attempted: true,
        success: true,
        status: 'NOT_NEEDED',
        targetQuantity: expectedQuantity,
        submittedValue: existingRaw || target,
        verifiedQuantity: existingQuantity,
        message: `Quantity was verified as ${expectedQuantity} in Jira's Edit Issue field; no correction was needed.`
      };
    }

    const writeResult = await writeJiraInputValue(input, target);
    if (!writeResult.success) {
      return failedQuantityUpdate(expectedQuantity, target, writeResult.message);
    }

    const saveControl = findEditIssueSaveControl(input);
    if (!saveControl) {
      return failedQuantityUpdate(
        expectedQuantity,
        target,
        'Quantity was replaced, but the Edit Issue Update/Save button was not found.'
      );
    }

    dispatchUserLikeClick(saveControl);
    await sleep(TIMING.DIALOG_SAVE_MS);

    if (findQuantityInput(settings, 'dialog')) {
      const submitResult = await submitEditIssueForm(input);
      if (!submitResult.success) {
        const error = findQuantityEditError();
        if (error) {
          return failedQuantityUpdate(expectedQuantity, target, `Jira rejected the Quantity update: ${error}`);
        }
      }
    }

    let verification = await waitForSavedQuantity(expectedQuantity, settings, 25000);
    if (!verification.success) {
      const dialogVerification = await verifyQuantityThroughEditDialog(expectedQuantity, settings);
      if (dialogVerification.success) verification = dialogVerification;
    }

    if (!verification.success) {
      return failedQuantityUpdate(expectedQuantity, target, verification.message);
    }

    return {
      attempted: true,
      success: true,
      status: 'UPDATED',
      targetQuantity: expectedQuantity,
      submittedValue: target,
      verifiedQuantity: verification.verifiedQuantity ?? expectedQuantity,
      message: `Quantity was replaced from ${existingRaw || 'empty'} to ${expectedQuantity} and the persisted value was verified.`
    };
  }

  async function submitEditIssueForm(input) {
    const token = `jira-validator-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('data-jira-validator-token', token);
    try {
      return await runMainWorldAction({
        action: 'SUBMIT_EDIT_FORM',
        token
      });
    } finally {
      input.removeAttribute('data-jira-validator-token');
    }
  }

  function failedQuantityUpdate(targetQuantity, submittedValue, message) {
    return {
      attempted: true,
      success: false,
      status: 'FAILED',
      targetQuantity,
      submittedValue,
      verifiedQuantity: null,
      message
    };
  }

  async function waitForQuantityInput(settings, timeoutMs, mode = 'any') {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = findQuantityInput(settings, mode);
      if (input) return input;
      await sleep(TIMING.INPUT_POLL_MS);
    }
    return null;
  }

  function findQuantityInput(settings, mode = 'any') {
    const selectors = [
      settings.quantityInputSelector,
      'input#customfield_13618:not([type="hidden"])',
      'input[name="customfield_13618"]:not([type="hidden"])',
      'input[id*="customfield_13618"]:not([type="hidden"])',
      'input[aria-label="Quantity" i]:not([type="hidden"])'
    ].filter(Boolean);

    const candidates = [];
    for (const root of getSearchRoots()) {
      for (const selector of [...new Set(selectors)]) {
        let matches = [];
        try {
          matches = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }
        for (const candidate of matches) {
          if (!candidates.includes(candidate)) candidates.push(candidate);
        }
      }
    }

    return candidates
      .filter((candidate) => candidate instanceof HTMLInputElement)
      .filter((candidate) => !candidate.disabled && !candidate.readOnly && candidate.type !== 'hidden')
      .filter((candidate) => mode !== 'dialog' || isInsideEditIssueContainer(candidate))
      .filter((candidate) => mode !== 'view' || !isInsideEditIssueContainer(candidate))
      .map((candidate) => ({ candidate, score: scoreQuantityInput(candidate, mode) }))
      .sort((a, b) => b.score - a.score)[0]?.candidate || null;
  }

  function scoreQuantityInput(input, mode) {
    const identity = normaliseText([
      input.id,
      input.name,
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder')
    ].filter(Boolean).join(' ')).toLowerCase();

    let score = 0;
    if (input.id === 'customfield_13618' || input.name === 'customfield_13618') score += 200;
    if (/\bquantity\b/.test(identity)) score += 120;
    if (/customfield[_-]?13618/.test(identity)) score += 180;
    if (input.type === 'text' || input.type === 'number' || !input.type) score += 20;
    if (isInsideEditIssueContainer(input)) score += mode === 'dialog' ? 150 : 30;
    if (input.offsetParent === null && input.getClientRects().length === 0) score -= 15;
    return score;
  }

  async function waitForSavedQuantity(expectedQuantity, settings, timeoutMs) {
    const started = Date.now();
    let lastObserved = null;

    while (Date.now() - started < timeoutMs) {
      if (Content.detectDeadLinkPage()) {
        return { success: false, verifiedQuantity: lastObserved, message: 'Jira navigated to its dead-link page while saving Quantity.' };
      }
      const quantityField = Content.findQuantityField(settings);
      const observed = parseQuantity(quantityField.value);
      if (Number.isSafeInteger(observed)) {
        lastObserved = observed;
        if (observed === expectedQuantity) {
          return { success: true, verifiedQuantity: observed, message: `Verified Jira Quantity as ${expectedQuantity}.` };
        }
      }

      const error = findQuantityEditError();
      if (error) {
        return { success: false, verifiedQuantity: lastObserved, message: `Jira rejected the Quantity update: ${error}` };
      }
      await sleep(TIMING.SAVE_VERIFY_POLL_MS);
    }

    return {
      success: false,
      verifiedQuantity: lastObserved,
      message: Number.isSafeInteger(lastObserved)
        ? `Timed out verifying Quantity. Expected ${expectedQuantity}, but Jira still showed ${lastObserved}.`
        : `Timed out verifying that Jira saved Quantity as ${expectedQuantity}.`
    };
  }

  async function verifyQuantityThroughEditDialog(expectedQuantity, settings) {
    const existingInput = findQuantityInput(settings, 'dialog');
    if (existingInput) {
      const value = parseQuantity(existingInput.value);
      const error = findQuantityEditError();
      return {
        success: false,
        verifiedQuantity: value,
        message: error || `The Edit Issue dialog remained open after submission, so Quantity ${value ?? 'empty'} was not treated as persisted.`
      };
    }

    const editControl = findEditIssueControl();
    if (!editControl) {
      return { success: false, verifiedQuantity: null, message: 'Could not reopen Edit Issue to verify Quantity.' };
    }

    dispatchUserLikeClick(editControl, { preventAnchorNavigation: true });
    const input = await waitForQuantityInput(settings, 10000, 'dialog');
    if (!input) {
      return { success: false, verifiedQuantity: null, message: 'Edit Issue reopened, but Quantity input was not found for verification.' };
    }

    const value = parseQuantity(input.value);
    await cancelEditIssueDialog(input);
    return value === expectedQuantity
      ? { success: true, verifiedQuantity: value, message: `Verified persisted Quantity as ${expectedQuantity} by reopening Edit Issue.` }
      : { success: false, verifiedQuantity: value, message: `Reopened Edit Issue showed Quantity ${value ?? 'empty'} instead of ${expectedQuantity}.` };
  }

  async function cancelEditIssueDialog(input) {
    const roots = [
      input.closest('form'),
      input.closest('[role="dialog"], .aui-dialog2, .aui-dialog'),
      document
    ].filter(Boolean);
    const cancel = findControlInRoots(
      roots,
      [
        'button.cancel',
        'a.cancel',
        'button[data-action="cancel"]',
        'button[id*="cancel" i]',
        '.aui-dialog2-footer-close',
        'button[aria-label="Close" i]'
      ],
      /^(?:cancel|close)$/i,
      document
    );
    if (cancel) dispatchUserLikeClick(cancel);
    else {
      for (const type of ['keydown', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
          bubbles: true, cancelable: true, composed: true
        }));
      }
    }
    await sleep(TIMING.DIALOG_CANCEL_MS);
  }

  function findQuantityEditError() {
    const roots = [
      document.querySelector('#customfield_13618')?.closest('.field-group, form, [role="dialog"]'),
      document.querySelector('[role="dialog"]'),
      document.querySelector('.aui-dialog2'),
      document.querySelector('.aui-dialog')
    ].filter(Boolean);
    const selectors = ['.error', '.error-message', '.aui-message-error', '[role="alert"]', '.field-error', '.form-error'];

    for (const root of roots) {
      for (const selector of selectors) {
        let elements = [];
        try {
          elements = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }
        for (const element of elements) {
          const text = normaliseText(element.textContent || element.innerText || '');
          if (text && /quantity|required|invalid|permission|error|cannot|unable/i.test(text)) {
            return text.slice(0, 700);
          }
        }
      }
    }
    return '';
  }

  async function updateDueDateViaUi(targetDate, settings, ticket, dueUiOptions = {}) {
    const targetDateIso = formatIsoDate(targetDate);
    if (
      isAemPagePublishTimePresent(settings)
      && settings.skipDueDateRuleWhenPublishTimePresent !== false
    ) {
      return {
        attempted: false,
        success: false,
        status: 'NOT_APPLICABLE',
        targetDateIso,
        submittedValue: '',
        message: DUE_RULE_SKIPPED_PUBLISH_TIME_MESSAGE
      };
    }

    if (!fieldPresent(settings.dueDateSelector, '#due-date')) {
      return {
        attempted: false,
        success: false,
        status: 'NOT_APPLICABLE',
        targetDateIso,
        submittedValue: '',
        message: 'Due date update was not attempted because the Due field is not on the issue view.'
      };
    }

    const currentDueField = Content.findDateField(
      settings.dueDateLabel,
      ['due-date', 'duedate'],
      settings.dueDateSelector
    );
    const currentLiveField = Content.findDateField(
      settings.liveDateLabel,
      ['live-date', 'livedate'],
      settings.liveDateSelector
    );
    const currentDueDate = parseDate(currentDueField.value, settings.numericDateOrder);
    const liveDateForRule = dueUiOptions.liveDateForRule || null;
    const currentLiveDate = parseDate(currentLiveField.value, settings.numericDateOrder)
      || liveDateForRule;
    const duePresent = fieldPresent(settings.dueDateSelector, '#due-date');
    const livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');
    const dueUpdateOptions = {
      autoUpdateDueDateOnlyWhenTooEarly: settings.autoUpdateDueDateOnlyWhenTooEarly !== false,
      publishTimePresent: isAemPagePublishTimePresent(settings),
      skipDueRuleWhenPublishTimePresent: settings.skipDueDateRuleWhenPublishTimePresent !== false,
      liveDateFromHistory: dueUiOptions.liveDateFromHistory === true
    };
    const liveReadyForUpdate = livePresent || dueUpdateOptions.liveDateFromHistory === true;
    if (
      !dueUiOptions.skipPreflightCheck
      && !shouldAttemptDueDateUpdate(
        currentDueDate,
        currentLiveDate,
        settings.comparisonRule,
        true,
        duePresent,
        liveReadyForUpdate,
        dueUpdateOptions
      )
    ) {
      const differenceInDays = dueLiveDifferenceInDays(currentDueDate, currentLiveDate);
      const skipMessage = differenceInDays !== null && differenceInDays > 2
        ? buildDueUpdateSkipStateWhenDueAlreadyLate(differenceInDays).message
        : differenceInDays === 2
          ? 'Due already equals Live Date plus 2 calendar days.'
          : 'Due date update was not needed.';
      return {
        attempted: false,
        success: false,
        status: 'NOT_NEEDED',
        targetDateIso,
        submittedValue: '',
        message: skipMessage
      };
    }

    const diagnostics = [];
    const readiness = await Content.waitForPage(ticket, 15000, { requireIssueFields: true, settings });
    if (!readiness.ready) {
      return failedDueUpdate(targetDateIso, '', `Jira was not ready before editing Due. ${readiness.message}`);
    }

    const inlineResult = await tryInlineDueDateUpdate(targetDate, settings);
    diagnostics.push(`Inline editor: ${inlineResult.message}`);
    if (inlineResult.success) return inlineResult;

    await cancelOpenDueEditor();

    const fallbackReadiness = await Content.waitForPage(ticket, 12000, { requireIssueFields: true, settings });
    if (!fallbackReadiness.ready) {
      diagnostics.push(`Edit Issue fallback was skipped because Jira was not ready: ${fallbackReadiness.message}`);
      return {
        attempted: true,
        success: false,
        status: 'FAILED',
        targetDateIso,
        submittedValue: inlineResult.submittedValue || '',
        message: [`Could not update Due to ${targetDateIso}.`, ...diagnostics].join(' ')
      };
    }

    const dialogResult = await tryEditIssueDialogDueDateUpdate(targetDate, settings, ticket);
    diagnostics.push(`Edit Issue fallback: ${dialogResult.message}`);
    if (dialogResult.success) return dialogResult;

    return {
      attempted: true,
      success: false,
      status: 'FAILED',
      targetDateIso,
      submittedValue: inlineResult.submittedValue || dialogResult.submittedValue || '',
      message: [
        `Could not update Due to ${targetDateIso}.`,
        ...diagnostics,
        'Confirm that the user can edit the issue and has Jira’s Schedule Issues permission.'
      ].join(' ')
    };
  }

  async function tryInlineDueDateUpdate(targetDate, settings) {
    const targetDateIso = formatIsoDate(targetDate);
    const field = findDueEditableField();

    if (!field) {
      return failedDueUpdate(targetDateIso, '', 'The editable Jira Due field (#due-date) was not found.');
    }

    const opened = await openDueInlineEditor(field);
    if (!opened.input) {
      return failedDueUpdate(
        targetDateIso,
        '',
        `Jira did not open an inline Due editor. ${opened.diagnostic}`
      );
    }

    const input = opened.input;
    const submittedValue = formatDueDateInputValue(input, targetDate, settings.numericDateOrder);
    const writeResult = await writeJiraInputValue(input, submittedValue);
    if (!writeResult.success) {
      return failedDueUpdate(targetDateIso, submittedValue, writeResult.message);
    }

    const commitResult = await commitInlineDueEdit(input, field);
    if (!commitResult.success) {
      return failedDueUpdate(targetDateIso, submittedValue, commitResult.message);
    }

    const verification = await waitForSavedDueDate(targetDateIso, settings, 22000);
    if (!verification.success) {
      return failedDueUpdate(
        targetDateIso,
        submittedValue,
        `${verification.message} Inline commit method: ${commitResult.method}.`
      );
    }

    return {
      attempted: true,
      success: true,
      status: 'UPDATED',
      targetDateIso,
      submittedValue,
      message: `Due was updated through Jira inline edit and verified as ${targetDateIso} (Live Date + 2 calendar days). Commit method: ${commitResult.method}.`
    };
  }

  async function openDueInlineEditor(field) {
    const triggers = [
      field.querySelector('[role="button"][aria-label*="Edit Due Date" i]'),
      field.querySelector('.overlay-icon.aui-iconfont-edit'),
      field.querySelector('.overlay-icon'),
      field
    ].filter(Boolean);

    try {
      field.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      // Scrolling is optional in an inactive processing tab.
    }

    for (let attempt = 0; attempt < triggers.length; attempt += 1) {
      const trigger = triggers[attempt];
      dispatchUserLikeClick(trigger);

      const input = await waitForDueDateInput(attempt === 0 ? 3500 : 2200, 'inline');
      if (input) {
        return {
          input,
          diagnostic: `Opened using ${describeElement(trigger)}.`
        };
      }

      if (trigger === field || attempt === triggers.length - 1) {
        activateWithKeyboard(field);
        const keyboardInput = await waitForDueDateInput(2500, 'inline');
        if (keyboardInput) {
          return {
            input: keyboardInput,
            diagnostic: 'Opened using Enter on #due-date.'
          };
        }
      }
    }

    return {
      input: null,
      diagnostic: `Field classes after click: “${field.className || '(none)'}”. ${describeDueEditorState()}`
    };
  }

  function prepareLiveDateInputForEdit(input) {
    const writer = globalThis.JiraValidatorInputWriter;
    if (writer?.prepareLiveDateInputForEdit) {
      return writer.prepareLiveDateInputForEdit(input);
    }
    if (!input) return false;
    const id = String(input.id || '').toLowerCase();
    const name = String(input.name || '').toLowerCase();
    if (id !== 'customfield_16801' && name !== 'customfield_16801') return false;
    input.disabled = false;
    input.readOnly = false;
    input.removeAttribute('disabled');
    input.removeAttribute('readonly');
    input.removeAttribute('aria-disabled');
    input.classList?.remove('clientreadonly');
    return true;
  }

  async function writeJiraInputValue(input, value, writeOptions = {}) {
    prepareLiveDateInputForEdit(input);
    const token = `jira-validator-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('data-jira-validator-token', token);
    const numericOrder = writeOptions.numericOrder || 'DMY';

    try {
      const mainWorld = await runMainWorldAction({
        action: 'SET_INPUT_VALUE',
        token,
        value
      });

      setInputValue(input, value);
      await sleep(TIMING.INPUT_WRITE_SETTLE_MS);

      const observed = String(input.value || '').trim();
      const expected = String(value || '').trim();
      if (observed !== expected) {
        const writer = globalThis.JiraValidatorInputWriter;
        const isLiveField = writer?.isLiveDateFieldInput?.(input);
        if (isLiveField && writeOptions.allowLiveNormalized !== false) {
          const expectedDate = parseDate(expected, numericOrder);
          const observedDate = parseDate(observed, numericOrder);
          if (
            expectedDate
            && observedDate
            && formatIsoDate(expectedDate) === formatIsoDate(observedDate)
          ) {
            return {
              success: true,
              message: `Replaced the Live Date input (Jira normalised “${expected}” to “${observed}”). MAIN-world response: ${mainWorld.message}`
            };
          }
        }
        return {
          success: false,
          message: `The Jira editor did not retain the replacement value. Expected “${expected}”, observed “${observed || 'empty'}”. MAIN-world response: ${mainWorld.message}`
        };
      }

      return {
        success: true,
        message: `Replaced the Jira input value with “${observed}”. MAIN-world response: ${mainWorld.message}`
      };
    } finally {
      input.removeAttribute('data-jira-validator-token');
    }
  }

  async function commitInlineDueEdit(input, originalField) {
    const saveControl = findDueDateSaveControl(input);
    if (saveControl) {
      dispatchUserLikeClick(saveControl);
      await sleep(TIMING.INLINE_COMMIT_MS);
      return { success: true, method: `clicked ${describeElement(saveControl)}` };
    }

    const token = `jira-validator-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    input.setAttribute('data-jira-validator-token', token);
    let mainWorld;
    try {
      mainWorld = await runMainWorldAction({
        action: 'COMMIT_INLINE_EDIT',
        token,
        fieldId: originalField?.id || 'due-date'
      });
    } finally {
      input.removeAttribute('data-jira-validator-token');
    }

    blurInputAndFocusPage(input);
    await sleep(TIMING.BLUR_COMMIT_MS);

    return {
      success: true,
      method: `Jira save-on-blur (${mainWorld.message})`
    };
  }

  async function tryEditIssueDialogDueDateUpdate(targetDate, settings, ticket) {
    const targetDateIso = formatIsoDate(targetDate);
    const editControl = findEditIssueControl();
    if (!editControl) {
      return failedDueUpdate(targetDateIso, '', 'The Jira Edit Issue control was not found.');
    }

    dispatchUserLikeClick(editControl, { preventAnchorNavigation: true });
    const input = await waitForDueDateInput(15000, 'dialog');
    if (!input) {
      return failedDueUpdate(
        targetDateIso,
        '',
        `The Edit Issue control was clicked, but no Due input appeared. ${describeDueEditorState()}`
      );
    }

    const submittedValue = formatDueDateInputValue(input, targetDate, settings.numericDateOrder);
    const writeResult = await writeJiraInputValue(input, submittedValue);
    if (!writeResult.success) {
      return failedDueUpdate(targetDateIso, submittedValue, writeResult.message);
    }

    const saveControl = findEditIssueSaveControl(input);
    if (!saveControl) {
      return failedDueUpdate(
        targetDateIso,
        submittedValue,
        'The Edit Issue dialog opened and the Due value was entered, but its Update/Save button was not found.'
      );
    }

    dispatchUserLikeClick(saveControl);
    const verification = await waitForSavedDueDate(targetDateIso, settings, 30000);
    if (!verification.success) {
      return failedDueUpdate(targetDateIso, submittedValue, verification.message);
    }

    return {
      attempted: true,
      success: true,
      status: 'UPDATED',
      targetDateIso,
      submittedValue,
      message: `Due was updated through Jira’s Edit Issue dialog and verified as ${targetDateIso} (Live Date + 2 calendar days).`
    };
  }

  function failedDueUpdate(targetDateIso, submittedValue, message) {
    return {
      attempted: true,
      success: false,
      status: 'FAILED',
      targetDateIso,
      submittedValue,
      message
    };
  }

  function findDueEditableField() {
    const selectors = [
      'span#due-date[data-name="Due"]',
      '#due-date.editable-field',
      'span#due-date',
      '#due-date'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  async function waitForDueDateInput(timeoutMs, mode = 'any') {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = findDueDateInput(mode);
      if (input) return input;
      await sleep(TIMING.INPUT_POLL_MS);
    }
    return null;
  }

  function findDueDateInput(mode = 'any') {
    const selectors = [
      '#due-date-field:not([type="hidden"])',
      'input#duedate:not([type="hidden"])',
      'input[name="duedate"]:not([type="hidden"])',
      'input[name="dueDate"]:not([type="hidden"])',
      'input[name="fields[duedate]"]:not([type="hidden"])',
      'input[id*="due-date" i]:not([type="hidden"])',
      'input[id*="duedate" i]:not([type="hidden"])',
      'input[data-fieldtype="datepicker"]:not([type="hidden"])',
      'input[aria-label*="Due Date" i]:not([type="hidden"])',
      '.editable-field.active input:not([type="hidden"])',
      '.save-options input:not([type="hidden"])'
    ];

    const candidates = [];
    for (const root of getSearchRoots()) {
      for (const selector of selectors) {
        let matches = [];
        try {
          matches = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }
        for (const candidate of matches) {
          if (!candidates.includes(candidate)) candidates.push(candidate);
        }
      }
    }

    return candidates
      .filter((candidate) => !candidate.disabled && !candidate.readOnly)
      .map((candidate) => ({ candidate, score: scoreDueInput(candidate, mode) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.candidate || null;
  }

  function scoreDueInput(input, mode) {
    const identity = normaliseText([
      input.id,
      input.name,
      input.className,
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder'),
      input.getAttribute('data-fieldtype')
    ].filter(Boolean).join(' ')).toLowerCase();

    let score = 0;
    if (/\bdue[-_ ]?date\b|\bduedate\b/.test(identity)) score += 100;
    if (input.id === 'duedate' || input.name === 'duedate') score += 80;
    if (input.getAttribute('data-fieldtype') === 'datepicker') score += 20;
    if (input.type === 'date' || input.type === 'text' || !input.type) score += 10;
    if (input.closest('#due-date, [id*="due-date" i], [data-name="Due"]')) score += 90;
    if (input.closest('.editable-field.active, .save-options')) score += mode === 'inline' ? 60 : 15;
    if (input.closest('[role="dialog"], .aui-dialog, .aui-dialog2, form#issue-edit, form[id*="edit-issue" i]')) {
      score += mode === 'dialog' ? 70 : 15;
    }
    if (input.offsetParent === null && input.getClientRects().length === 0) score -= 15;
    if (/live|start|created|resolved/.test(identity)) score -= 200;
    return score;
  }

  function findDueDateSaveControl(input) {
    const editorContainer = input.closest('.editable-field.active, form, [data-field-id="due-date"]') || input.parentElement;
    const roots = [
      editorContainer,
      editorContainer?.parentElement,
      input.closest('dd'),
      document
    ].filter(Boolean);
    const selectors = [
      '.save-options button.submit:not([disabled])',
      '.save-options input.submit:not([disabled])',
      '.save-options button[type="submit"]:not([disabled])',
      '.save-options input[type="submit"]:not([disabled])',
      'button.aui-button.submit:not([disabled])',
      'button[type="submit"]:not([disabled])',
      'input[type="submit"]:not([disabled])',
      'button[data-action="save"]:not([disabled])',
      'button[id*="save" i]:not([disabled])',
      '.aui-button-primary:not([disabled])'
    ];

    return findControlInRoots(roots, selectors, /^(?:save|update|submit|apply|ok)(?:\s+due(?:\s+date)?)?$/i, document);
  }

  function findEditIssueControl() {
    const selectors = [
      '#edit-issue',
      'a#edit-issue',
      'button#edit-issue',
      'a.issueaction-edit-issue',
      '[data-id="edit-issue"]',
      '[data-testid*="edit-issue" i]',
      '[aria-label="Edit issue" i]',
      'a[href*="/secure/EditIssue!default.jspa"]',
      'a[href*="/secure/EditIssue.jspa"]'
    ];

    for (const selector of selectors) {
      const controls = [...document.querySelectorAll(selector)];
      const control = controls.find((candidate) => {
        if (candidate.disabled || candidate.getAttribute('aria-disabled') === 'true') return false;
        if (!Content.isVisible(candidate)) return false;
        const href = candidate.getAttribute('href') || '';
        return !href || href === '#' || href.startsWith('/') || href.startsWith(location.origin);
      });
      if (control) return control;
    }

    const operationRoots = [
      document.querySelector('#opsbar-opsbar-operations'),
      document.querySelector('#issue-tools'),
      document.querySelector('.issue-actions'),
      document.querySelector('[data-testid*="issue-actions" i]')
    ].filter(Boolean);

    for (const root of operationRoots) {
      const control = [...root.querySelectorAll('button, a, [role="button"]')].find((element) => {
        if (element.disabled || element.getAttribute('aria-disabled') === 'true' || !Content.isVisible(element)) return false;
        const text = normaliseText(
          element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || ''
        );
        return /^(?:edit|edit issue)$/i.test(text);
      });
      if (control) return control;
    }

    return null;
  }

  function findEditIssueSaveControl(input) {
    const roots = [
      input.closest('form'),
      input.closest('[role="dialog"], .aui-dialog2, .aui-dialog'),
      document
    ].filter(Boolean);
    const selectors = [
      '#edit-issue-submit:not([disabled])',
      'button[name="Update"]:not([disabled])',
      'input[name="Update"]:not([disabled])',
      'button[type="submit"]:not([disabled])',
      'input[type="submit"]:not([disabled])',
      '.aui-button-primary:not([disabled])',
      'button[data-action="save"]:not([disabled])'
    ];

    return findControlInRoots(roots, selectors, /^(?:update|save|submit|apply|ok)$/i, document);
  }

  async function cancelOpenDueEditor() {
    const input = findDueDateInput('inline');
    if (!input) return;

    const roots = [
      input.closest('.editable-field.active'),
      input.closest('dd'),
      input.parentElement
    ].filter(Boolean);

    const cancel = findControlInRoots(
      roots,
      [
        '.save-options .cancel',
        '.save-options button[type="button"]',
        'button[data-action="cancel"]',
        'button[id*="cancel" i]',
        'a.cancel'
      ],
      /^(?:cancel|close)$/i,
      document
    );

    if (cancel) {
      dispatchUserLikeClick(cancel);
      await sleep(TIMING.DIALOG_CANCEL_MS);
      return;
    }

    for (const type of ['keydown', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    }
    await sleep(TIMING.INPUT_WRITE_SETTLE_MS);
  }

  function describeDueEditorState() {
    const activeFields = document.querySelectorAll('.editable-field.active').length;
    const dueLikeInputs = document.querySelectorAll(
      'input[id*="due" i]:not([type="hidden"]), input[name*="due" i]:not([type="hidden"]), input[data-fieldtype="datepicker"]:not([type="hidden"])'
    ).length;
    const dialogs = document.querySelectorAll('[role="dialog"], .aui-dialog, .aui-dialog2').length;
    const errors = findDueDateEditError();
    return `Detected ${activeFields} active editable field(s), ${dueLikeInputs} Due/date input candidate(s), and ${dialogs} dialog(s).${errors ? ` Jira message: ${errors}` : ''}`;
  }

  async function waitForSavedDueDate(targetDateIso, settings, timeoutMs) {
    const started = Date.now();
    let lastObserved = '';
    let lastInputValue = '';

    while (Date.now() - started < timeoutMs) {
      if (Content.detectDeadLinkPage()) {
        return { success: false, message: 'Jira navigated to its dead-link page while saving Due.' };
      }
      const timeElement = document.querySelector('#due-date time[datetime], #due-date time');
      const timeDate = parseDate(
        timeElement?.getAttribute('datetime') || timeElement?.textContent || '',
        settings.numericDateOrder
      );
      if (timeDate) {
        lastObserved = formatIsoDate(timeDate);
        if (lastObserved === targetDateIso) {
          return { success: true, message: `Verified Jira Due as ${targetDateIso}.` };
        }
      }

      const viewField = Content.findDateField(
        settings.dueDateLabel,
        ['due-date', 'duedate'],
        settings.dueDateSelector
      );
      const parsedViewValue = parseDate(viewField.value, settings.numericDateOrder);
      if (parsedViewValue) {
        lastObserved = formatIsoDate(parsedViewValue);
        if (lastObserved === targetDateIso) {
          return { success: true, message: `Verified Jira Due as ${targetDateIso}.` };
        }
      }

      const remainingInput = findDueDateInput('any');
      if (remainingInput) lastInputValue = String(remainingInput.value || '').trim();

      const errorText = findDueDateEditError();
      if (errorText) {
        return { success: false, message: `Jira rejected the Due update: ${errorText}` };
      }

      await sleep(TIMING.SAVE_VERIFY_POLL_MS);
    }

    const editorState = describeDueEditorState();
    return {
      success: false,
      message: lastObserved
        ? `Timed out verifying the Due update. Expected ${targetDateIso}, but Jira still showed ${lastObserved}. ${editorState}`
        : lastInputValue
          ? `Timed out verifying the Due update. The editor still contained “${lastInputValue}”, but the saved Due field did not become ${targetDateIso}. ${editorState}`
          : `Timed out verifying that Jira saved Due as ${targetDateIso}. ${editorState}`
    };
  }

  function failedLiveUpdate(targetDateIso, submittedValue, message, status = 'FAILED') {
    return {
      attempted: status !== 'NOT_APPLICABLE' && status !== 'NOT_NEEDED',
      success: false,
      status,
      targetDateIso,
      submittedValue,
      message
    };
  }

  async function updateLiveAndDueFromHistoryViaEditIssue(liveDate, targetDueDate, settings, ticket, options = {}) {
    const targetLiveIso = formatIsoDate(liveDate);
    const targetDueIso = formatIsoDate(targetDueDate);
    const updateDue = options.updateDue !== false && Boolean(targetDueDate);
    const liveUiOptions = {
      rawTimestamp: options.rawTimestamp || '',
      editIssueOnly: true
    };

    const readiness = await Content.waitForPage(ticket, 15000, { requireIssueFields: true, settings });
    if (!readiness.ready) {
      const failLive = failedLiveUpdate(
        targetLiveIso,
        '',
        `Jira was not ready before editing Live Date. ${readiness.message}`
      );
      return {
        liveUpdate: failLive,
        dueUpdate: updateDue
          ? failedDueUpdate(targetDueIso, '', `Skipped Due update because Jira was not ready. ${readiness.message}`)
          : {
            attempted: false,
            success: false,
            status: 'NOT_ATTEMPTED',
            targetDateIso: targetDueIso,
            submittedValue: '',
            message: ''
          }
      };
    }

    const dialogResult = await tryEditIssueDialogLiveAndDueUpdate(
      liveDate,
      updateDue ? targetDueDate : null,
      settings,
      liveUiOptions
    );

    const liveUpdate = dialogResult.liveUpdate;
    let dueUpdate = dialogResult.dueUpdate;

    if (updateDue && dueUpdate.status === 'NOT_ATTEMPTED' && liveUpdate.success) {
      dueUpdate = await updateDueDateViaUi(targetDueDate, settings, ticket, {
        liveDateForRule: liveDate,
        liveDateFromHistory: true,
        skipPreflightCheck: false
      });
    }

    return { liveUpdate, dueUpdate };
  }

  async function updateLiveDateViaUi(targetDate, settings, ticket, liveUiOptions = {}) {
    const targetDateIso = formatIsoDate(targetDate);
    const currentField = Content.findDateField(
      settings.liveDateLabel,
      ['live-date', 'livedate', 'customfield_16801'],
      settings.liveDateSelector
    );
    const currentDate = parseDate(currentField.value, settings.numericDateOrder);
    if (currentDate && formatIsoDate(currentDate) === targetDateIso) {
      return failedLiveUpdate(
        targetDateIso,
        '',
        `Live Date already matches ${targetDateIso}.`,
        'NOT_NEEDED'
      );
    }

    const readiness = await Content.waitForPage(ticket, 15000, { requireIssueFields: true, settings });
    if (!readiness.ready) {
      return failedLiveUpdate(targetDateIso, '', `Jira was not ready before editing Live Date. ${readiness.message}`);
    }

    const editIssueOnly = liveUiOptions.editIssueOnly === true || liveUiOptions.fromHistory === true;
    let inlineResult = {
      message: 'Inline edit was skipped (Edit Issue strategy).',
      submittedValue: '',
      status: 'NOT_ATTEMPTED'
    };

    if (!editIssueOnly) {
      inlineResult = await tryInlineLiveDateUpdate(targetDate, settings, liveUiOptions);
      if (inlineResult.success) return inlineResult;
      await cancelOpenLiveEditor();
    }

    const dialogResult = await tryEditIssueDialogLiveDateUpdate(targetDate, settings, ticket, liveUiOptions);
    if (dialogResult.success) return dialogResult;

    if (editIssueOnly) {
      return {
        attempted: true,
        success: false,
        status: 'FAILED',
        targetDateIso,
        submittedValue: dialogResult.submittedValue || '',
        message: `Could not update Live Date to ${targetDateIso}. Edit Issue: ${dialogResult.message}`
      };
    }

    return {
      attempted: true,
      success: false,
      status: 'FAILED',
      targetDateIso,
      submittedValue: inlineResult.submittedValue || dialogResult.submittedValue || '',
      message: [
        `Could not update Live Date to ${targetDateIso}.`,
        `Inline editor: ${inlineResult.message}`,
        `Edit Issue fallback: ${dialogResult.message}`
      ].join(' ')
    };
  }

  async function tryInlineLiveDateUpdate(targetDate, settings, liveUiOptions = {}) {
    const targetDateIso = formatIsoDate(targetDate);
    const field = findLiveEditableField();
    if (!field) {
      return failedLiveUpdate(targetDateIso, '', 'The editable Live Date field (#customfield_16801-val) was not found.', 'NOT_ATTEMPTED');
    }

    const opened = await openLiveInlineEditor(field);
    if (!opened.input) {
      return failedLiveUpdate(targetDateIso, '', `Jira did not open a Live Date inline editor. ${opened.diagnostic}`);
    }

    const submittedValue = formatLiveDateInputValue(
      opened.input,
      targetDate,
      settings.numericDateOrder,
      { rawTimestamp: liveUiOptions.rawTimestamp }
    );
    const writeResult = await writeJiraInputValue(opened.input, submittedValue, {
      numericOrder: settings.numericDateOrder
    });
    if (!writeResult.success) {
      return failedLiveUpdate(targetDateIso, submittedValue, writeResult.message);
    }

    const commitResult = await commitInlineDueEdit(opened.input, field);
    const verification = await waitForSavedLiveDate(targetDateIso, settings, 22000);
    if (!verification.success) {
      return failedLiveUpdate(
        targetDateIso,
        submittedValue,
        `${verification.message} Inline commit method: ${commitResult.method}.`
      );
    }

    return {
      attempted: true,
      success: true,
      status: 'UPDATED',
      targetDateIso,
      submittedValue,
      message: `Live Date was updated through Jira inline edit and verified as ${targetDateIso}. Commit method: ${commitResult.method}.`
    };
  }

  async function openEditIssueDialogForFields() {
    const editControl = findEditIssueControl();
    if (!editControl) {
      return { success: false, message: 'The Jira Edit Issue control was not found.' };
    }
    dispatchUserLikeClick(editControl, { preventAnchorNavigation: true });
    return { success: true, message: 'Opened Edit Issue.' };
  }

  async function resolveLiveDateInputInDialog() {
    let input = await waitForLiveDateInput(15000, 'dialog');
    if (!input) {
      input = document.querySelector('#customfield_16801');
    }
    if (input) {
      prepareLiveDateInputForEdit(input);
    }
    return input;
  }

  async function tryEditIssueDialogLiveAndDueUpdate(liveDate, targetDueDate, settings, liveUiOptions = {}) {
    const targetLiveIso = formatIsoDate(liveDate);
    const targetDueIso = targetDueDate ? formatIsoDate(targetDueDate) : '';
    const updateDue = Boolean(targetDueDate);

    const opened = await openEditIssueDialogForFields();
    if (!opened.success) {
      const fail = failedLiveUpdate(targetLiveIso, '', opened.message);
      return {
        liveUpdate: fail,
        dueUpdate: updateDue
          ? failedDueUpdate(targetDueIso, '', opened.message)
          : {
            attempted: false,
            success: false,
            status: 'NOT_ATTEMPTED',
            targetDateIso: targetDueIso,
            submittedValue: '',
            message: ''
          }
      };
    }

    const liveInput = await resolveLiveDateInputInDialog();
    if (!liveInput) {
      const message = 'The Edit Issue control was clicked, but no Live Date input appeared.';
      return {
        liveUpdate: failedLiveUpdate(targetLiveIso, '', message),
        dueUpdate: updateDue ? failedDueUpdate(targetDueIso, '', message) : {
          attempted: false,
          success: false,
          status: 'NOT_ATTEMPTED',
          targetDateIso: targetDueIso,
          submittedValue: '',
          message: ''
        }
      };
    }

    const liveSubmittedValue = formatLiveDateInputValue(
      liveInput,
      liveDate,
      settings.numericDateOrder,
      { rawTimestamp: liveUiOptions.rawTimestamp }
    );
    const liveWriteResult = await writeJiraInputValue(liveInput, liveSubmittedValue, {
      numericOrder: settings.numericDateOrder
    });

    let dueSubmittedValue = '';
    let dueWriteOk = !updateDue;
    if (updateDue) {
      const dueInput = await waitForDueDateInput(8000, 'dialog');
      if (!dueInput) {
        return {
          liveUpdate: liveWriteResult.success
            ? failedLiveUpdate(
              targetLiveIso,
              liveSubmittedValue,
              'Live Date was entered, but the Due field was not found in the same Edit Issue dialog.'
            )
            : failedLiveUpdate(targetLiveIso, liveSubmittedValue, liveWriteResult.message),
          dueUpdate: failedDueUpdate(targetDueIso, '', 'Due input was not found in Edit Issue dialog.')
        };
      }
      dueSubmittedValue = formatDueDateInputValue(dueInput, targetDueDate, settings.numericDateOrder);
      const dueWriteResult = await writeJiraInputValue(dueInput, dueSubmittedValue, {
        numericOrder: settings.numericDateOrder
      });
      dueWriteOk = dueWriteResult.success;
      if (!dueWriteOk) {
        return {
          liveUpdate: liveWriteResult.success
            ? failedLiveUpdate(targetLiveIso, liveSubmittedValue, `Live Date was entered, but Due write failed: ${dueWriteResult.message}`)
            : failedLiveUpdate(targetLiveIso, liveSubmittedValue, liveWriteResult.message),
          dueUpdate: failedDueUpdate(targetDueIso, dueSubmittedValue, dueWriteResult.message)
        };
      }
    }

    if (!liveWriteResult.success) {
      return {
        liveUpdate: failedLiveUpdate(targetLiveIso, liveSubmittedValue, liveWriteResult.message),
        dueUpdate: updateDue && dueWriteOk
          ? failedDueUpdate(
            targetDueIso,
            dueSubmittedValue,
            `Due was entered, but Live Date write failed: ${liveWriteResult.message}`
          )
          : {
            attempted: false,
            success: false,
            status: 'NOT_ATTEMPTED',
            targetDateIso: targetDueIso,
            submittedValue: dueSubmittedValue,
            message: updateDue ? '' : ''
          }
      };
    }

    const saveControl = findEditIssueSaveControl(liveInput);
    if (!saveControl) {
      const message = 'The Edit Issue dialog opened and field values were entered, but its Update/Save button was not found.';
      return {
        liveUpdate: failedLiveUpdate(targetLiveIso, liveSubmittedValue, message),
        dueUpdate: updateDue ? failedDueUpdate(targetDueIso, dueSubmittedValue, message) : {
          attempted: false,
          success: false,
          status: 'NOT_ATTEMPTED',
          targetDateIso: targetDueIso,
          submittedValue: '',
          message: ''
        }
      };
    }

    dispatchUserLikeClick(saveControl);

    const liveVerification = await waitForSavedLiveDate(targetLiveIso, settings, 30000);
    let dueUpdate;
    if (updateDue) {
      const dueVerification = await waitForSavedDueDate(targetDueIso, settings, 22000);
      dueUpdate = dueVerification.success
        ? {
          attempted: true,
          success: true,
          status: 'UPDATED',
          targetDateIso: targetDueIso,
          submittedValue: dueSubmittedValue,
          message: `Due was updated through Jira’s Edit Issue dialog (with Live Date) and verified as ${targetDueIso} (Live Date + 2 calendar days).`
        }
        : failedDueUpdate(targetDueIso, dueSubmittedValue, dueVerification.message);
    } else {
      dueUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_ATTEMPTED',
        targetDateIso: '',
        submittedValue: '',
        message: ''
      };
    }

    const liveUpdate = liveVerification.success
      ? {
        attempted: true,
        success: true,
        status: 'UPDATED',
        targetDateIso: targetLiveIso,
        submittedValue: liveSubmittedValue,
        message: updateDue
          ? `Live Date was updated through Jira’s Edit Issue dialog (with Due) and verified as ${targetLiveIso}.`
          : `Live Date was updated through Jira’s Edit Issue dialog and verified as ${targetLiveIso}.`
      }
      : failedLiveUpdate(targetLiveIso, liveSubmittedValue, liveVerification.message);

    return { liveUpdate, dueUpdate };
  }

  async function tryEditIssueDialogLiveDateUpdate(targetDate, settings, ticket, liveUiOptions = {}) {
    const targetDateIso = formatIsoDate(targetDate);
    const combined = await tryEditIssueDialogLiveAndDueUpdate(targetDate, null, settings, liveUiOptions);
    return combined.liveUpdate;
  }

  function findLiveEditableField() {
    const selectors = [
      '#customfield_16801-val.editable-field',
      '#customfield_16801-val',
      '[id="customfield_16801-val"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  async function openLiveInlineEditor(field) {
    const triggers = [
      field.querySelector('[role="button"][aria-label*="Live Date" i]'),
      field.querySelector('.overlay-icon.aui-iconfont-edit'),
      field.querySelector('.overlay-icon'),
      field
    ].filter(Boolean);

    for (let attempt = 0; attempt < triggers.length; attempt += 1) {
      dispatchUserLikeClick(triggers[attempt]);
      const input = await waitForLiveDateInput(attempt === 0 ? 3500 : 2200, 'inline');
      if (input) {
        return { input, diagnostic: `Opened Live Date editor using ${describeElement(triggers[attempt])}.` };
      }
    }

    return { input: null, diagnostic: 'Could not open the Live Date inline editor.' };
  }

  async function waitForLiveDateInput(timeoutMs, mode = 'any') {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = findLiveDateInput(mode);
      if (input) return input;
      await sleep(TIMING.INPUT_POLL_MS);
    }
    return null;
  }

  function findLiveDateInput(mode = 'any') {
    const selectors = [
      'input#customfield_16801:not([type="hidden"])',
      'input[name="customfield_16801"]:not([type="hidden"])',
      'input[name="fields[customfield_16801]"]:not([type="hidden"])',
      'input[id*="16801" i]:not([type="hidden"])',
      'input[aria-label*="Live Date" i]:not([type="hidden"])'
    ];

    const candidates = [];
    for (const root of getSearchRoots()) {
      for (const selector of selectors) {
        let matches = [];
        try {
          matches = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }
        for (const candidate of matches) {
          if (!candidates.includes(candidate)) candidates.push(candidate);
        }
      }
    }

    const direct = document.querySelector('#customfield_16801');
    if (direct && !candidates.includes(direct)) candidates.push(direct);

    return candidates
      .filter((candidate) => {
        const id = String(candidate.id || '').toLowerCase();
        const name = String(candidate.name || '').toLowerCase();
        if (id === 'customfield_16801' || name === 'customfield_16801') return true;
        return !candidate.disabled && !candidate.readOnly;
      })
      .map((candidate) => ({ candidate, score: scoreLiveInput(candidate, mode) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.candidate || null;
  }

  function scoreLiveInput(input, mode) {
    const identity = normaliseText([
      input.id,
      input.name,
      input.className,
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder')
    ].filter(Boolean).join(' ')).toLowerCase();

    let score = 0;
    if (/live[-_ ]?date|\bcustomfield_16801\b|\b16801\b/.test(identity)) score += 100;
    if (input.closest('#customfield_16801-val, [id*="16801" i]')) score += 90;
    if (input.closest('.editable-field.active, .save-options')) score += mode === 'inline' ? 60 : 15;
    if (input.closest('[role="dialog"], .aui-dialog, .aui-dialog2, form#issue-edit, form[id*="edit-issue" i]')) {
      score += mode === 'dialog' ? 70 : 15;
    }
    if (/due|duedate/.test(identity)) score -= 200;
    if (input.disabled || input.readOnly) score -= 5;
    return score;
  }

  async function waitForSavedLiveDate(targetDateIso, settings, timeoutMs) {
    const started = Date.now();
    let lastObserved = '';

    while (Date.now() - started < timeoutMs) {
      const viewField = Content.findDateField(
        settings.liveDateLabel,
        ['live-date', 'livedate', 'customfield_16801'],
        settings.liveDateSelector
      );
      const parsedViewValue = parseDate(viewField.value, settings.numericDateOrder);
      if (parsedViewValue) {
        lastObserved = formatIsoDate(parsedViewValue);
        if (lastObserved === targetDateIso) {
          return { success: true, message: `Verified Jira Live Date as ${targetDateIso}.` };
        }
      }

      const errorText = findLiveDateEditError();
      if (errorText) {
        return { success: false, message: `Jira rejected the Live Date update: ${errorText}` };
      }

      await sleep(TIMING.SAVE_VERIFY_POLL_MS);
    }

    return {
      success: false,
      message: lastObserved
        ? `Timed out verifying Live Date. Expected ${targetDateIso}, but Jira still showed ${lastObserved}.`
        : `Timed out verifying that Jira saved Live Date as ${targetDateIso}.`
    };
  }

  function findLiveDateEditError() {
    const roots = [
      document.querySelector('#customfield_16801')?.closest('dd'),
      document.querySelector('#customfield_16801-val')?.closest('dd'),
      document.querySelector('[role="dialog"]'),
      document.querySelector('.aui-dialog2'),
      document.querySelector('.aui-dialog'),
      document
    ].filter(Boolean);
    const selectors = [
      '.error',
      '.error-message',
      '.aui-message-error',
      '.aui-message.warning',
      '[role="alert"]',
      '.field-error',
      '.form-error'
    ];

    for (const root of roots) {
      for (const selector of selectors) {
        let elements = [];
        try {
          elements = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }
        for (const element of elements) {
          const text = normaliseText(element.textContent || element.innerText || '');
          if (text && /live|date|required|invalid|permission|error|cannot|unable|16801/i.test(text)) {
            return text.slice(0, 700);
          }
        }
      }
    }
    return '';
  }

  async function cancelOpenLiveEditor() {
    const input = findLiveDateInput('inline');
    if (!input) return;

    const roots = [
      input.closest('.editable-field.active'),
      input.closest('dd'),
      input.parentElement
    ].filter(Boolean);

    const cancel = findControlInRoots(
      roots,
      ['.save-options .cancel', 'button.cancel', 'a.cancel'],
      /^(?:cancel|close)$/i,
      document
    );
    if (cancel) {
      dispatchUserLikeClick(cancel);
      await sleep(TIMING.DIALOG_CANCEL_MS);
    }
  }

  function findDueDateEditError() {
    const roots = [
      document.querySelector('#due-date')?.closest('dd'),
      document.querySelector('#due-date'),
      document.querySelector('[role="dialog"]'),
      document.querySelector('.aui-dialog2'),
      document.querySelector('.aui-dialog'),
      document
    ].filter(Boolean);
    const selectors = [
      '.error',
      '.error-message',
      '.aui-message-error',
      '.aui-message.warning',
      '[role="alert"]',
      '.field-error',
      '.form-error'
    ];

    for (const root of roots) {
      for (const selector of selectors) {
        let elements = [];
        try {
          elements = [...root.querySelectorAll(selector)];
        } catch {
          continue;
        }
        for (const element of elements) {
          const text = normaliseText(element.textContent || element.innerText || '');
          if (text && /due|date|required|invalid|permission|schedule|error|cannot|unable/i.test(text)) {
            return text.slice(0, 700);
          }
        }
      }
    }
    return '';
  }

  Object.assign(Content, {
    updateQuantityViaUi,
    submitEditIssueForm,
    failedQuantityUpdate,
    waitForQuantityInput,
    findQuantityInput,
    scoreQuantityInput,
    waitForSavedQuantity,
    verifyQuantityThroughEditDialog,
    cancelEditIssueDialog,
    findQuantityEditError,
    updateDueDateViaUi,
    updateLiveDateViaUi,
    updateLiveAndDueFromHistoryViaEditIssue,
    tryInlineDueDateUpdate,
    openDueInlineEditor,
    writeJiraInputValue,
    commitInlineDueEdit,
    tryEditIssueDialogDueDateUpdate,
    failedDueUpdate,
    findDueEditableField,
    waitForDueDateInput,
    findDueDateInput,
    scoreDueInput,
    findDueDateSaveControl,
    findEditIssueControl,
    findEditIssueSaveControl,
    cancelOpenDueEditor,
    describeDueEditorState,
    waitForSavedDueDate,
    findDueDateEditError
  });
})();
