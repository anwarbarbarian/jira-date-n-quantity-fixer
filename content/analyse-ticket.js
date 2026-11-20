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
    SCHEDULED_PUBLISH_TIME_CLOSURE_MESSAGE,
    parseQuantity,
    resolveExpectedQuantity,
    formatExpectedQuantitySource,
    validateQuantity,
    isQuantitySkippedIssueType,
    isDueDateSkippedIssueType,
    isTicketValidationSuccessful
  } = JV;

  function dateValidationContext(settings, duePresent, livePresent, historyState = {}, issueTypeState = {}) {
    return {
      duePresent,
      livePresent,
      publishTimePresent: isAemPagePublishTimePresent(settings),
      skipDueValidationWhenMissing: settings.skipDueDateValidationWhenMissing !== false,
      skipLiveDateValidationWhenMissing: settings.skipLiveDateValidationWhenMissing !== false,
      skipDueRuleWhenPublishTimePresent: settings.skipDueDateRuleWhenPublishTimePresent !== false,
      skipDueRuleForIssueType: issueTypeState.skipDueRuleForIssueType === true,
      issueTypeName: issueTypeState.issueTypeName || '',
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
    const issueTypeName = Content.detectIssueTypeName();
    const skipDueRuleForIssueType = isDueDateSkippedIssueType(issueTypeName, settings);
    const publishTimeOnIssue = isAemPagePublishTimePresent(settings);
    const mayUseHistoryLiveDate = settings.useLiveDateFromStatusHistory !== false
      && !publishTimeOnIssue
      && !skipDueRuleForIssueType;
    const issueTypeValidationState = { skipDueRuleForIssueType, issueTypeName };

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
    }, issueTypeValidationState);
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
      skipDueRuleForIssueType: dateContext.skipDueRuleForIssueType,
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
        }, issueTypeValidationState);
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
        dateContext = dateValidationContext(settings, duePresent, livePresent, {}, issueTypeValidationState);
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

    const issueLabels = Content.detectIssueLabels(settings);
    const aemFieldPresent = fieldPresent(settings.aemPagePathSelector, '#customfield_14002-val');
    const skipQuantityForIssueType = isQuantitySkippedIssueType(issueTypeName, settings);
    const skipQuantityMissingAemField = !skipQuantityForIssueType && !aemFieldPresent;
    const skipQuantity = skipQuantityForIssueType || skipQuantityMissingAemField;
    let pagePathField;
    let expectedQuantity;
    let aemPathLineCount = 0;
    let quantityLabelBonus = 0;
    let matchedQuantityLabels = [];
    const quantityUsesFixedIssueTypeRule = false;

    if (skipQuantity) {
      pagePathField = {
        lines: [],
        rawText: '',
        note: skipQuantityForIssueType
          ? `Issue type “${issueTypeName}”: AEM Page Path and Quantity validation were not applied.`
          : 'AEM Page Path field is not on the issue view — Quantity validation and update were not applied.'
      };
      expectedQuantity = null;
    } else {
      pagePathField = await Content.findAemPagePaths(settings);
      aemPathLineCount = pagePathField.lines.length;
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

    if (skipQuantity) {
      quantityValidation = {
        status: 'SKIPPED',
        message: skipQuantityForIssueType
          ? `Quantity rule was skipped for issue type “${issueTypeName}”.`
          : 'Quantity rule was skipped because the AEM Page Path field is not on the issue view.'
      };
      quantityUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_APPLICABLE',
        targetQuantity: null,
        submittedValue: '',
        verifiedQuantity: quantity,
        message: skipQuantityForIssueType
          ? 'Automatic Quantity update was not attempted because Quantity validation is disabled for this issue type.'
          : 'Automatic Quantity update was not attempted because the AEM Page Path field is not on the issue view.'
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
          ? `Quantity already matches expected ${expectedQuantity} (${formatExpectedQuantitySource(
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

    const validationSnapshot = {
      errorCode: '',
      dateStatus: dateValidation.status,
      quantityStatus: quantityValidation.status,
      liveUpdateAttempted: liveUpdate.attempted,
      liveUpdateSuccess: liveUpdate.success,
      dueUpdateAttempted: dueUpdate.attempted,
      dueUpdateSuccess: dueUpdate.success,
      quantityUpdateAttempted: quantityUpdate.attempted,
      quantityUpdateSuccess: quantityUpdate.success
    };

    let resolutionUpdate;
    if (settings.autoUpdateResolutionOnSuccess === false) {
      resolutionUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_APPLICABLE',
        targetValue: '',
        submittedValue: '',
        verifiedResolution: Content.readResolutionOnView?.(settings) || '',
        message: 'Automatic Resolution update is disabled in settings.'
      };
    } else if (!isTicketValidationSuccessful(validationSnapshot)) {
      resolutionUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_ATTEMPTED',
        targetValue: String(settings.resolutionCompletedValue || '10500'),
        submittedValue: '',
        verifiedResolution: Content.readResolutionOnView?.(settings) || '',
        message: 'Resolution was not updated because Due or Quantity validation did not fully pass or an update failed.'
      };
    } else if (isAemPagePublishTimePresent(settings)) {
      resolutionUpdate = {
        attempted: false,
        success: false,
        status: 'NOT_APPLICABLE',
        targetValue: '',
        submittedValue: '',
        verifiedResolution: Content.readResolutionOnView?.(settings) || '',
        message: SCHEDULED_PUBLISH_TIME_CLOSURE_MESSAGE,
        pendingReasonUpdateAttempted: false,
        pendingReasonUpdateSuccess: false,
        pendingReasonUpdateStatus: 'NOT_APPLICABLE',
        pendingReasonUpdateSubmittedValue: '',
        verifiedPendingReason: Content.readPendingReasonOnView?.(settings) || '',
        pendingReasonUpdateMessage: SCHEDULED_PUBLISH_TIME_CLOSURE_MESSAGE
      };
    } else {
      const resolutionReadiness = await Content.waitForPage(
        ticket,
        12000,
        { requireIssueFields: true, settings }
      );
      if (!resolutionReadiness.ready) {
        resolutionUpdate = {
          attempted: false,
          success: false,
          status: 'NOT_ATTEMPTED',
          targetValue: String(settings.resolutionCompletedValue || '10500'),
          submittedValue: '',
          verifiedResolution: Content.readResolutionOnView?.(settings) || '',
          message: `Resolution update was skipped because Jira was not ready: ${resolutionReadiness.message}`
        };
      } else {
        resolutionUpdate = await Content.updateResolutionViaUi(settings, ticket);
      }
    }

    const resolutionRaw = resolutionUpdate.verifiedResolution
      || Content.readResolutionOnView?.(settings)
      || '';

    return {
      pageTitle: document.title,
      detectedIssueKey: Content.detectIssueKey(),
      issueTypeName,
      dueDateValidationSkipped: skipDueRuleForIssueType,
      quantityUsesFixedIssueTypeRule,
      quantityValidationSkipped: skipQuantity,
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
      resolutionRaw,
      resolutionUpdateAttempted: resolutionUpdate.attempted,
      resolutionUpdateSuccess: resolutionUpdate.success,
      resolutionUpdateStatus: resolutionUpdate.status,
      resolutionUpdateTarget: resolutionUpdate.targetValue,
      resolutionUpdateSubmittedValue: resolutionUpdate.submittedValue,
      resolutionUpdateMessage: resolutionUpdate.message,
      pendingReasonRaw: resolutionUpdate.verifiedPendingReason || '',
      pendingReasonUpdateAttempted: resolutionUpdate.pendingReasonUpdateAttempted === true,
      pendingReasonUpdateSuccess: resolutionUpdate.pendingReasonUpdateSuccess === true,
      pendingReasonUpdateStatus: resolutionUpdate.pendingReasonUpdateStatus || 'NOT_APPLICABLE',
      pendingReasonUpdateSubmittedValue: resolutionUpdate.pendingReasonUpdateSubmittedValue || '',
      pendingReasonUpdateMessage: resolutionUpdate.pendingReasonUpdateMessage || '',
      fieldExtractionNotes: fieldNotes,
      errorCode: '',
      errorMessage: ''
    };
  }

  function buildErrorResult(errorCode, errorMessage, settings = {}) {
    const issueTypeName = Content.detectIssueTypeName();
    const skipDueRule = isDueDateSkippedIssueType(issueTypeName, settings);
    const aemFieldPresent = fieldPresent(settings.aemPagePathSelector, '#customfield_14002-val');
    const skipQuantityForIssueType = isQuantitySkippedIssueType(issueTypeName, settings);
    const skipQuantity = skipQuantityForIssueType || !aemFieldPresent;
    return {
      pageTitle: document.title,
      detectedIssueKey: Content.detectIssueKey(),
      issueTypeName,
      dueDateValidationSkipped: skipDueRule,
      quantityUsesFixedIssueTypeRule: false,
      quantityValidationSkipped: skipQuantity,
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
      dateStatus: skipDueRule ? 'SKIPPED' : 'ERROR',
      dateMessage: skipDueRule
        ? JV.dueRuleSkippedForIssueTypeMessage(issueTypeName)
        : errorMessage,
      comparisonRule: '',
      dueUpdateAttempted: false,
      dueUpdateSuccess: false,
      dueUpdateStatus: skipDueRule ? 'NOT_APPLICABLE' : 'NOT_ATTEMPTED',
      dueUpdateTargetIso: '',
      dueUpdateSubmittedValue: '',
      dueUpdateMessage: skipDueRule
        ? JV.dueRuleSkippedForIssueTypeMessage(issueTypeName)
        : '',
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
        ? (skipQuantityForIssueType
          ? `Quantity rule was skipped for issue type “${issueTypeName}”.`
          : 'Quantity rule was skipped because the AEM Page Path field is not on the issue view.')
        : errorMessage,
      quantityUpdateAttempted: false,
      quantityUpdateSuccess: false,
      quantityUpdateStatus: skipQuantity ? 'NOT_APPLICABLE' : 'NOT_ATTEMPTED',
      quantityUpdateTarget: null,
      quantityUpdateSubmittedValue: '',
      quantityUpdateMessage: skipQuantity
        ? (skipQuantityForIssueType
          ? 'Automatic Quantity update was not attempted because Quantity validation is disabled for this issue type.'
          : 'Automatic Quantity update was not attempted because the AEM Page Path field is not on the issue view.')
        : '',
      resolutionRaw: '',
      resolutionUpdateAttempted: false,
      resolutionUpdateSuccess: false,
      resolutionUpdateStatus: 'NOT_ATTEMPTED',
      resolutionUpdateTarget: '',
      resolutionUpdateSubmittedValue: '',
      resolutionUpdateMessage: 'Resolution was not updated because the ticket could not be analysed.',
      pendingReasonRaw: '',
      pendingReasonUpdateAttempted: false,
      pendingReasonUpdateSuccess: false,
      pendingReasonUpdateStatus: 'NOT_ATTEMPTED',
      pendingReasonUpdateSubmittedValue: '',
      pendingReasonUpdateMessage: 'Pending Reason was not updated because the ticket could not be analysed.',
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
