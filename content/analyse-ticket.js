'use strict';

(() => {
  const Content = globalThis.JiraValidatorContent = globalThis.JiraValidatorContent || {};
  const JV = globalThis.JiraValidator;
  const {
    parseDate,
    validateDates,
    resolveDateValidation,
    formatIsoDate,
    addUtcDays,
    buildDueUpdateSkipState,
    buildDueUpdateSkipStateWhenDueAlreadyLate,
    buildDueUpdateNotApplicableState,
    shouldAttemptDueDateUpdate,
    fieldPresent,
    isAemPagePublishTimePresent,
    parseQuantity,
    resolveExpectedQuantity,
    formatExpectedQuantitySource,
    validateQuantity,
    isAemOptionalIssueType,
    isQuantitySkippedIssueType,
    usesFixedQuantityWithoutAem,
    fixedQuantityForAemOptionalIssue
  } = JV;

  function dateValidationContext(settings, duePresent, livePresent, historyState = {}) {
    return {
      duePresent,
      livePresent,
      publishTimePresent: isAemPagePublishTimePresent(settings),
      skipDueValidationWhenMissing: settings.skipDueDateValidationWhenMissing !== false,
      skipLiveDateValidationWhenMissing: settings.skipLiveDateValidationWhenMissing !== false,
      skipDueRuleWhenPublishTimePresent: settings.skipDueDateRuleWhenPublishTimePresent !== false,
      historyLiveDate: historyState.liveDate || null,
      liveDateFromHistory: historyState.fromHistory === true,
      historyLiveDateNote: historyState.note || ''
    };
  }

  function liveDateReadyForDueRule(livePresent, dateContext) {
    return livePresent || dateContext.liveDateFromHistory === true;
  }

  async function analyseTicket(payload) {
    const settings = payload.settings;
    const ticket = payload.ticket;

    const initialReadiness = await Content.waitForPage(
      ticket,
      Math.min(settings.timeoutSeconds * 1000, 35000),
      { requireIssueFields: true, settings }
    );

    if (!initialReadiness.ready) {
      return buildErrorResult(initialReadiness.errorCode, initialReadiness.message, settings);
    }

    let duePresent = fieldPresent(settings.dueDateSelector, '#due-date');
    let livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');

    let dueField = Content.findDateField(
      settings.dueDateLabel,
      ['due-date', 'duedate'],
      settings.dueDateSelector
    );
    let liveField = Content.findDateField(
      settings.liveDateLabel,
      ['live-date', 'livedate'],
      settings.liveDateSelector
    );

    const originalDueDateRaw = dueField.value;
    const originalDueDate = parseDate(dueField.value, settings.numericDateOrder);

    duePresent = fieldPresent(settings.dueDateSelector, '#due-date');
    livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');
    dueField = Content.findDateField(
      settings.dueDateLabel,
      ['due-date', 'duedate'],
      settings.dueDateSelector
    );
    liveField = Content.findDateField(
      settings.liveDateLabel,
      ['live-date', 'livedate'],
      settings.liveDateSelector
    );

    let dueDate = parseDate(dueField.value, settings.numericDateOrder);
    let liveDate = parseDate(liveField.value, settings.numericDateOrder);
    let liveDateSource = liveDate ? 'field' : '';
    let liveUpdate = {
      attempted: false,
      success: false,
      status: 'NOT_ATTEMPTED',
      targetDateIso: '',
      submittedValue: '',
      message: ''
    };

    const dueFieldNotes = [];
    const publishTimeOnIssue = isAemPagePublishTimePresent(settings);
    const mayUseHistoryLiveDate = settings.useLiveDateFromStatusHistory !== false && !publishTimeOnIssue;

    let dueUpdate;
    let dueUpdateHandledFromHistoryEdit = false;
    let historyRawTimestamp = '';

    if (mayUseHistoryLiveDate && !liveDate) {
      const historyResult = await Content.resolveLiveDateFromIssueHistory(settings);
      if (historyResult.date) {
        liveDate = historyResult.date;
        liveDateSource = 'history';
        historyRawTimestamp = historyResult.rawTimestamp || '';
        liveField = {
          value: historyResult.rawTimestamp || formatIsoDate(liveDate),
          note: historyResult.message
        };
      } else if (historyResult.message) {
        liveField = {
          ...liveField,
          note: [liveField.note, historyResult.message].filter(Boolean).join(' | ')
        };
      }

      if (liveDateSource === 'history' && liveDate && settings.autoUpdateLiveDateFromHistory !== false) {
        const historyDueOptions = {
          autoUpdateDueDateOnlyWhenTooEarly: settings.autoUpdateDueDateOnlyWhenTooEarly !== false,
          publishTimePresent: publishTimeOnIssue,
          skipDueRuleWhenPublishTimePresent: settings.skipDueDateRuleWhenPublishTimePresent !== false,
          liveDateFromHistory: true
        };
        const targetDueFromHistory = addUtcDays(liveDate, 2);
        const shouldUpdateDueWithHistory = settings.autoUpdateDueDate
          && fieldPresent(settings.dueDateSelector, '#due-date')
          && shouldAttemptDueDateUpdate(
            dueDate,
            liveDate,
            settings.comparisonRule,
            true,
            true,
            true,
            historyDueOptions
          );

        if (shouldUpdateDueWithHistory) {
          const combined = await Content.updateLiveAndDueFromHistoryViaEditIssue(
            liveDate,
            targetDueFromHistory,
            settings,
            ticket,
            { rawTimestamp: historyRawTimestamp, updateDue: true }
          );
          liveUpdate = combined.liveUpdate;
          dueUpdate = combined.dueUpdate;
          dueUpdateHandledFromHistoryEdit = Boolean(dueUpdate?.success || dueUpdate?.status === 'NOT_NEEDED');
        } else {
          liveUpdate = await Content.updateLiveDateViaUi(liveDate, settings, ticket, {
            editIssueOnly: true,
            fromHistory: true,
            rawTimestamp: historyRawTimestamp
          });
        }

        livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');
        liveField = Content.findDateField(
          settings.liveDateLabel,
          ['live-date', 'livedate', 'customfield_16801'],
          settings.liveDateSelector
        );
        const liveAfterUpdate = parseDate(liveField.value, settings.numericDateOrder);
        if (liveAfterUpdate) {
          liveDate = liveAfterUpdate;
          liveDateSource = 'field';
        } else if (liveUpdate.success) {
          liveDateSource = 'field';
        }
      }
    }

    let dateContext = dateValidationContext(settings, duePresent, livePresent, {
      liveDate: liveDateSource === 'history' ? liveDate : null,
      fromHistory: liveDateSource === 'history',
      note: liveField.note || ''
    });
    let dateValidation = resolveDateValidation(
      dueDate,
      liveDate,
      settings.comparisonRule,
      dateContext
    );

    const liveReady = liveDateReadyForDueRule(livePresent, dateContext);

    const dueUpdateOptions = {
      autoUpdateDueDateOnlyWhenTooEarly: settings.autoUpdateDueDateOnlyWhenTooEarly !== false,
      publishTimePresent: dateContext.publishTimePresent,
      skipDueRuleWhenPublishTimePresent: dateContext.skipDueRuleWhenPublishTimePresent,
      liveDateFromHistory: dateContext.liveDateFromHistory
    };

    const dueUiContext = {
      liveDateForRule: liveDate,
      liveDateFromHistory: dateContext.liveDateFromHistory === true
    };

    if (dueUpdateHandledFromHistoryEdit) {
      if (!dueUpdate) {
        dueUpdate = {
          attempted: false,
          success: false,
          status: 'NOT_ATTEMPTED',
          targetDateIso: '',
          submittedValue: '',
          message: ''
        };
      }
    } else if (dateValidation.status === 'SKIPPED') {
      dueUpdate = buildDueUpdateNotApplicableState(dateValidation.message);
    } else if (
      dateValidation.status === 'PASS'
      && !shouldAttemptDueDateUpdate(
        dueDate,
        liveDate,
        settings.comparisonRule,
        settings.autoUpdateDueDate,
        duePresent,
        liveReady,
        dueUpdateOptions
      )
    ) {
      dueUpdate = dateValidation.dueDateExact === false
        ? buildDueUpdateSkipStateWhenDueAlreadyLate(dateValidation.differenceInDays)
        : buildDueUpdateSkipState(liveDate);
    } else if (shouldAttemptDueDateUpdate(
      dueDate,
      liveDate,
      settings.comparisonRule,
      settings.autoUpdateDueDate,
      duePresent,
      liveReady,
      dueUpdateOptions
    )) {
      const targetDueDate = addUtcDays(liveDate, 2);
      dueUpdate = await Content.updateDueDateViaUi(targetDueDate, settings, ticket, dueUiContext);

      if (dueUpdate.status === 'NOT_NEEDED') {
        duePresent = fieldPresent(settings.dueDateSelector, '#due-date');
        livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');
        dueField = Content.findDateField(
          settings.dueDateLabel,
          ['due-date', 'duedate'],
          settings.dueDateSelector
        );
        liveField = Content.findDateField(
          settings.liveDateLabel,
          ['live-date', 'livedate'],
          settings.liveDateSelector
        );
        dueDate = parseDate(dueField.value, settings.numericDateOrder);
        const parsedLiveAfterDue = parseDate(liveField.value, settings.numericDateOrder);
        if (parsedLiveAfterDue) {
          liveDate = parsedLiveAfterDue;
        }
        dateContext = dateValidationContext(settings, duePresent, livePresent, {
          liveDate: dateContext.liveDateFromHistory ? liveDate : null,
          fromHistory: dateContext.liveDateFromHistory,
          note: liveField.note || dateContext.historyLiveDateNote || ''
        });
        dateValidation = resolveDateValidation(
          dueDate,
          liveDate,
          settings.comparisonRule,
          dateContext
        );
        dueUpdate = buildDueUpdateSkipState(liveDate);
      } else if (dueUpdate.success) {
        duePresent = fieldPresent(settings.dueDateSelector, '#due-date');
        livePresent = fieldPresent(settings.liveDateSelector, '#customfield_16801-val');
        dueField = Content.findDateField(
          settings.dueDateLabel,
          ['due-date', 'duedate'],
          settings.dueDateSelector
        );
        dueDate = parseDate(dueField.value, settings.numericDateOrder);
        dateContext = dateValidationContext(settings, duePresent, livePresent);
        dateValidation = resolveDateValidation(
          dueDate,
          liveDate,
          settings.comparisonRule,
          dateContext
        );

        if (dateValidation.status !== 'PASS') {
          dueUpdate = {
            ...dueUpdate,
            success: false,
            status: 'FAILED',
            message: `Jira accepted the edit action, but the saved Due value could not be verified as ${dueUpdate.targetDateIso}.`
          };
        }
      }

      if (dueUpdate.attempted) {
        const postDueReadiness = await Content.waitForPage(ticket, 18000, { requireIssueFields: true, settings });
        if (!postDueReadiness.ready) {
          const readinessNote = postDueReadiness.errorCode === 'DEAD_LINK'
            ? 'Jira navigated to a dead-link page after the Due update.'
            : postDueReadiness.message;
          dueFieldNotes.push(`Due post-update readiness: ${readinessNote}`);
          dueUpdate = {
            ...dueUpdate,
            success: false,
            status: dueUpdate.success ? 'FAILED' : dueUpdate.status,
            message: `${dueUpdate.message} ${readinessNote} Quantity validation was still attempted.`
          };
        }
      }
    } else {
      dueUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_ATTEMPTED',
        targetDateIso: liveDate ? formatIsoDate(addUtcDays(liveDate, 2)) : '',
        submittedValue: '',
        message: dateValidation.status === 'ERROR' && !liveDate
          ? 'Automatic Due update could not run because Live Date was not parsed.'
          : dateValidation.status === 'ERROR' && !dueDate && duePresent
            ? 'Automatic Due update was not attempted because Due could not be parsed.'
            : dateValidation.status === 'PASS' && dateValidation.dueDateExact === false
              ? buildDueUpdateSkipStateWhenDueAlreadyLate(dateValidation.differenceInDays).message
              : settings.autoUpdateDueDate
                ? 'Automatic Due update was not attempted.'
                : 'Automatic Due update is disabled.'
      };
    }

    const issueTypeName = Content.detectIssueTypeName();
    const issueLabels = Content.detectIssueLabels(settings);
    const skipQuantityForIssueType = isQuantitySkippedIssueType(issueTypeName, settings);
    const fixedQuantityWhenAemMissing = usesFixedQuantityWithoutAem(issueTypeName, settings);
    let pagePathField;
    let expectedQuantity;
    let aemPathLineCount = 0;
    let quantityLabelBonus = 0;
    let matchedQuantityLabels = [];
    let quantityUsesFixedIssueTypeRule = false;
    if (skipQuantityForIssueType) {
      pagePathField = {
        lines: [],
        rawText: '',
        note: `Issue type “${issueTypeName}”: AEM Page Path and Quantity validation were not applied.`
      };
      expectedQuantity = null;
    } else if (fixedQuantityWhenAemMissing) {
      const aemFieldPresent = fieldPresent(settings.aemPagePathSelector, '#customfield_14002-val');
      if (aemFieldPresent) {
        pagePathField = await Content.findAemPagePaths(settings);
        aemPathLineCount = pagePathField.lines.length;
      } else {
        quantityUsesFixedIssueTypeRule = true;
        expectedQuantity = fixedQuantityForAemOptionalIssue(settings);
        pagePathField = {
          lines: [],
          rawText: '',
          note: `Issue type “${issueTypeName}” has no AEM Page Path field; expected Quantity is ${expectedQuantity}.`
        };
      }
    } else {
      pagePathField = await Content.findAemPagePaths(settings);
      aemPathLineCount = pagePathField.lines.length;
    }

    if (!skipQuantityForIssueType && !quantityUsesFixedIssueTypeRule) {
      const resolved = resolveExpectedQuantity(
        aemPathLineCount,
        issueLabels,
        settings.quantityLabelBonuses
      );
      aemPathLineCount = resolved.pathLineCount;
      quantityLabelBonus = resolved.labelBonus;
      matchedQuantityLabels = resolved.matchedLabels;
      expectedQuantity = resolved.expectedQuantity;
    }

    const quantityValidationContext = {
      aemPathLineCount,
      labelBonus: quantityLabelBonus,
      matchedLabels: matchedQuantityLabels
    };

    let quantityField = Content.findQuantityField(settings);
    const originalQuantityRaw = quantityField.value;
    const originalQuantity = parseQuantity(quantityField.value);
    let quantity = originalQuantity;
    let quantityValidation;
    let quantityUpdate;

    if (skipQuantityForIssueType) {
      quantityValidation = {
        status: 'SKIPPED',
        message: `Quantity rule was skipped for issue type “${issueTypeName}”.`
      };
      quantityUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_APPLICABLE',
        targetQuantity: null,
        submittedValue: '',
        verifiedQuantity: quantity,
        message: 'Automatic Quantity update was not attempted because Quantity validation is disabled for this issue type.'
      };
    } else {
      quantityValidation = validateQuantity(quantity, expectedQuantity, quantityValidationContext);

      if (quantityValidation.status === 'ERROR' && expectedQuantity === 0 && pagePathField.note) {
        quantityValidation = {
          ...quantityValidation,
          message: `${quantityValidation.message} ${pagePathField.note}`
        };
      }

      quantityUpdate = {
        attempted: false,
        success: false,
        status: quantityValidation.status === 'PASS' ? 'NOT_NEEDED' : 'NOT_ATTEMPTED',
        targetQuantity: expectedQuantity || null,
        submittedValue: '',
        verifiedQuantity: quantity,
        message: quantityValidation.status === 'PASS'
          ? quantityUsesFixedIssueTypeRule
            ? `Quantity already matches the fixed value ${expectedQuantity} for issue type “${issueTypeName}”.`
            : `Quantity already matches expected ${expectedQuantity} (${formatExpectedQuantitySource(
              aemPathLineCount,
              quantityLabelBonus,
              matchedQuantityLabels
            )}).`
          : expectedQuantity === 0
            ? `Automatic Quantity update was not attempted because no AEM Page Path lines were found. ${pagePathField.note || ''}`.trim()
            : settings.autoUpdateQuantity
              ? 'Automatic Quantity update was not attempted.'
              : 'Automatic Quantity update is disabled.'
      };

      if (settings.autoUpdateQuantity && expectedQuantity > 0 && quantityValidation.status !== 'PASS') {
        quantityUpdate = await Content.updateQuantityViaUi(expectedQuantity, settings, ticket);

        if (quantityUpdate.success) {
          quantityField = Content.findQuantityField(settings);
          const renderedQuantity = parseQuantity(quantityField.value);
          const verifiedQuantity = Number.isSafeInteger(quantityUpdate.verifiedQuantity)
            ? quantityUpdate.verifiedQuantity
            : null;
          quantity = verifiedQuantity ?? renderedQuantity ?? expectedQuantity;
          quantityValidation = validateQuantity(quantity, expectedQuantity, quantityValidationContext);

          if (quantityValidation.status === 'PASS' && verifiedQuantity !== null) {
            quantityField = {
              value: String(verifiedQuantity),
              note: `${quantityField.note || 'Quantity was not immediately refreshed on the issue view.'} Final persisted Quantity ${verifiedQuantity} was verified through Edit Issue.`
            };
          }

          if (quantityValidation.status !== 'PASS') {
            quantityUpdate = {
              ...quantityUpdate,
              success: false,
              status: 'FAILED',
              message: `Jira accepted the Quantity edit action, but the saved value could not be verified as ${expectedQuantity}.`
            };
          }
        }
      }
    }

    const fieldNotes = [
      ...dueFieldNotes,
      dueField.note ? `${settings.dueDateLabel}: ${dueField.note}` : '',
      liveField.note ? `${settings.liveDateLabel}: ${liveField.note}` : '',
      pagePathField.note ? `${settings.aemPagePathLabel}: ${pagePathField.note}` : '',
      quantityField.note ? `${settings.quantityLabel}: ${quantityField.note}` : ''
    ].filter(Boolean).join(' | ');

    return {
      pageTitle: document.title,
      detectedIssueKey: Content.detectIssueKey(),
      issueTypeName,
      quantityUsesFixedIssueTypeRule,
      quantityValidationSkipped: skipQuantityForIssueType,
      originalDueDateRaw,
      originalDueDateIso: originalDueDate ? formatIsoDate(originalDueDate) : '',
      dueDateRaw: dueField.value,
      liveDateRaw: liveField.value,
      dueDateIso: dueDate ? formatIsoDate(dueDate) : '',
      liveDateIso: liveDate ? formatIsoDate(liveDate) : '',
      liveDateSource,
      liveUpdateAttempted: liveUpdate.attempted,
      liveUpdateSuccess: liveUpdate.success,
      liveUpdateStatus: liveUpdate.status,
      liveUpdateTargetIso: liveUpdate.targetDateIso || (liveDate ? formatIsoDate(liveDate) : ''),
      liveUpdateSubmittedValue: liveUpdate.submittedValue,
      liveUpdateMessage: liveUpdate.message,
      dateStatus: dateValidation.status,
      dateMessage: dateValidation.message,
      dateDueExact: dateValidation.dueDateExact !== false,
      comparisonRule: settings.comparisonRule,
      dueUpdateAttempted: dueUpdate.attempted,
      dueUpdateSuccess: dueUpdate.success,
      dueUpdateStatus: dueUpdate.status,
      dueUpdateTargetIso: dueUpdate.targetDateIso,
      dueUpdateSubmittedValue: dueUpdate.submittedValue,
      dueUpdateMessage: dueUpdate.message,
      issueLabels,
      aemPagePathCount: aemPathLineCount,
      aemPagePathLines: pagePathField.lines,
      quantityLabelBonus,
      quantityExpected: Number.isSafeInteger(expectedQuantity) ? expectedQuantity : null,
      originalQuantityRaw,
      originalQuantity,
      quantityRaw: Number.isSafeInteger(quantity) ? String(quantity) : quantityField.value,
      quantity,
      quantityStatus: quantityValidation.status,
      quantityMessage: quantityValidation.message,
      quantityUpdateAttempted: quantityUpdate.attempted,
      quantityUpdateSuccess: quantityUpdate.success,
      quantityUpdateStatus: quantityUpdate.status,
      quantityUpdateTarget: quantityUpdate.targetQuantity,
      quantityUpdateSubmittedValue: quantityUpdate.submittedValue,
      quantityUpdateMessage: quantityUpdate.message,
      fieldExtractionNotes: fieldNotes,
      errorCode: '',
      errorMessage: ''
    };
  }

  function buildErrorResult(errorCode, errorMessage, settings = {}) {
    const issueTypeName = Content.detectIssueTypeName();
    const skipQuantity = isQuantitySkippedIssueType(issueTypeName, settings);
    const aemFieldPresent = fieldPresent(settings.aemPagePathSelector, '#customfield_14002-val');
    const quantityUsesFixedIssueTypeRule = usesFixedQuantityWithoutAem(issueTypeName, settings)
      && !aemFieldPresent;
    return {
      pageTitle: document.title,
      detectedIssueKey: Content.detectIssueKey(),
      issueTypeName,
      quantityUsesFixedIssueTypeRule,
      quantityValidationSkipped: isQuantitySkippedIssueType(issueTypeName, settings),
      originalDueDateRaw: '',
      originalDueDateIso: '',
      dueDateRaw: '',
      liveDateRaw: '',
      dueDateIso: '',
      liveDateIso: '',
      liveDateSource: '',
      liveUpdateAttempted: false,
      liveUpdateSuccess: false,
      liveUpdateStatus: 'NOT_ATTEMPTED',
      liveUpdateTargetIso: '',
      liveUpdateSubmittedValue: '',
      liveUpdateMessage: '',
      dateStatus: 'ERROR',
      dateMessage: errorMessage,
      comparisonRule: '',
      dueUpdateAttempted: false,
      dueUpdateSuccess: false,
      dueUpdateStatus: 'NOT_ATTEMPTED',
      dueUpdateTargetIso: '',
      dueUpdateSubmittedValue: '',
      dueUpdateMessage: '',
      issueLabels: Content.detectIssueLabels(settings),
      aemPagePathCount: 0,
      aemPagePathLines: [],
      quantityLabelBonus: 0,
      quantityExpected: null,
      originalQuantityRaw: '',
      originalQuantity: null,
      quantityRaw: '',
      quantity: null,
      quantityStatus: skipQuantity ? 'SKIPPED' : 'ERROR',
      quantityMessage: skipQuantity
        ? `Quantity rule was skipped for issue type “${issueTypeName}”.`
        : errorMessage,
      quantityUpdateAttempted: false,
      quantityUpdateSuccess: false,
      quantityUpdateStatus: skipQuantity ? 'NOT_APPLICABLE' : 'NOT_ATTEMPTED',
      quantityUpdateTarget: null,
      quantityUpdateSubmittedValue: '',
      quantityUpdateMessage: skipQuantity
        ? 'Automatic Quantity update was not attempted because Quantity validation is disabled for this issue type.'
        : '',
      fieldExtractionNotes: '',
      errorCode,
      errorMessage
    };
  }

  Object.assign(Content, {
    analyseTicket,
    buildErrorResult
  });
})();
