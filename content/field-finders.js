'use strict';

(() => {
  const Content = globalThis.JiraValidatorContent = globalThis.JiraValidatorContent || {};
  const JV = globalThis.JiraValidator;
  const {
    normaliseText,
    normaliseLabel,
    cssEscape,
    escapeRegExp,
    readElementValue,
    isVisible,
    isInsideEditIssueContainer,
    sleep,
    dispatchUserLikeClick,
    TIMING
  } = Content;
  const { extractDateToken: jvExtractDateToken, extractNonEmptyLines, extractQuantityToken } = JV;

  function extractDateToken(rawValue) {
    return jvExtractDateToken(rawValue);
  }

  function findDateField(label, aliases, customSelector) {
    const direct = findDirectDateCandidate(label, aliases, customSelector);
    if (direct.value) return direct;

    const labelElements = findExactLabelElements(label);
    for (const labelElement of labelElements) {
      const candidate = extractValueNearLabel(labelElement, label);
      if (candidate.value) return candidate;
    }

    return {
      value: '',
      note: `Could not find a date near the field label “${label}”. Configure the exact Jira field label or add a selector in content.js.`
    };
  }

  function findDirectDateCandidate(label, aliases, customSelector) {
    if (customSelector) {
      try {
        for (const element of document.querySelectorAll(customSelector)) {
          const dateToken = extractDateToken(readElementValue(element));
          if (dateToken) {
            return { value: dateToken, note: `Read from custom selector ${customSelector}.` };
          }
        }
      } catch {
        return { value: '', note: `Invalid custom selector: ${customSelector}` };
      }
    }

    const selectors = [];
    for (const alias of aliases) {
      selectors.push(`#${cssEscape(alias)}`);
      selectors.push(`[id*="${cssEscape(alias)}" i]`);
      selectors.push(`[data-testid*="${cssEscape(alias)}" i]`);
      selectors.push(`[aria-label*="${cssEscape(alias)}" i]`);
    }

    for (const selector of selectors) {
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        continue;
      }

      for (const element of elements) {
        const raw = readElementValue(element);
        const dateToken = extractDateToken(raw);
        if (dateToken) {
          return { value: dateToken, note: `Read from ${selector}.` };
        }
      }
    }

    const attributeElements = document.querySelectorAll('[aria-label], [title], [data-testid]');
    const labelWords = normaliseText(label).toLowerCase().split(' ').filter(Boolean);
    for (const element of attributeElements) {
      const attributes = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('data-testid')
      ].filter(Boolean).join(' ').toLowerCase();

      if (!labelWords.every((word) => attributes.includes(word))) continue;
      const dateToken = extractDateToken(readElementValue(element));
      if (dateToken) {
        return { value: dateToken, note: 'Read from a matching Jira field attribute.' };
      }
    }

    return { value: '', note: '' };
  }

  function findExactLabelElements(label) {
    const expected = normaliseLabel(label);
    const candidates = document.querySelectorAll(
      'label, dt, th, legend, strong, b, span, div, h1, h2, h3, h4, [role="heading"]'
    );

    return [...candidates]
      .filter(isVisible)
      .filter((element) => {
        const text = normaliseLabel(element.textContent || '');
        return text === expected;
      })
      .slice(0, 25);
  }

  function extractValueNearLabel(labelElement, label) {
    const labelText = normaliseText(label);

    if (labelElement.tagName === 'LABEL') {
      const forId = labelElement.getAttribute('for');
      if (forId) {
        const linked = document.getElementById(forId);
        const linkedDate = extractDateToken(readElementValue(linked));
        if (linkedDate) return { value: linkedDate, note: 'Read from the field linked to its label.' };
      }
    }

    let sibling = labelElement.nextElementSibling;
    for (let count = 0; sibling && count < 3; count += 1, sibling = sibling.nextElementSibling) {
      const dateToken = extractDateToken(readElementValue(sibling));
      if (dateToken) return { value: dateToken, note: 'Read from the field label’s next sibling.' };
    }

    let container = labelElement.parentElement;
    for (let level = 1; container && level <= 6; level += 1, container = container.parentElement) {
      const timeElement = container.querySelector('time[datetime]');
      if (timeElement) {
        const dateToken = extractDateToken(timeElement.getAttribute('datetime') || timeElement.textContent || '');
        if (dateToken) return { value: dateToken, note: `Read from a time element ${level} level(s) above the label.` };
      }

      const inputs = container.querySelectorAll('input, textarea, [contenteditable="true"]');
      for (const input of inputs) {
        const dateToken = extractDateToken(readElementValue(input));
        if (dateToken) return { value: dateToken, note: `Read from an editable field near “${label}”.` };
      }

      const containerText = normaliseText(container.innerText || container.textContent || '');
      if (containerText.length > 0 && containerText.length <= 500) {
        const withoutLabel = containerText.replace(new RegExp(escapeRegExp(labelText), 'i'), ' ');
        const dateToken = extractDateToken(withoutLabel);
        if (dateToken) return { value: dateToken, note: `Read from a nearby Jira field container (${level} level(s)).` };
      }
    }

    return { value: '', note: '' };
  }

  function aemPagePathSelectors(settings) {
    return [
      settings.aemPagePathSelector,
      '#customfield_14002-val .twixi-wrap .flooded',
      '#field-customfield_14002 .twixi-wrap .flooded',
      '#customfield_14002-val .twixi-wrap.verbose .flooded',
      '#field-customfield_14002 .twixi-wrap.verbose .flooded',
      '#customfield_14002-val .flooded',
      '#field-customfield_14002 .flooded',
      '#customfield_14002-val textarea',
      'textarea#customfield_14002',
      'textarea[name="customfield_14002"]',
      '#customfield_14002-val',
      '#field-customfield_14002'
    ].filter(Boolean);
  }

  function findAemPagePathsFromDom(settings) {
    let invalidSelector = '';
    for (const selector of [...new Set(aemPagePathSelectors(settings))]) {
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        invalidSelector = selector;
        continue;
      }

      for (const element of elements) {
        const lines = extractNonEmptyLines(element);
        if (lines.length) {
          return {
            lines,
            rawText: lines.join('\n'),
            note: `Counted ${lines.length} non-empty line(s) from ${selector}.`
          };
        }
      }
    }

    return {
      lines: [],
      rawText: '',
      note: invalidSelector
        ? `Could not count AEM Page Path lines; selector “${invalidSelector}” is invalid.`
        : 'Could not find non-empty AEM Page Path lines in custom field 14002. Try expanding AEM Page Path or adjust the AEM selector in settings.'
    };
  }

  async function expandAemPagePathField() {
    const roots = [
      document.querySelector('#customfield_14002-val'),
      document.querySelector('#field-customfield_14002'),
      document.querySelector('[id="customfield_14002-val"]')
    ].filter(Boolean);

    for (const root of roots) {
      if (root.querySelector('.twixi-wrap.verbose .flooded')) return true;

      const candidates = [
        ...root.querySelectorAll('a, button, [role="button"], .twixi-trigger, .show-view')
      ].filter((element) => {
        if (!isVisible(element)) return false;
        const text = normaliseText(element.textContent || element.innerText || element.getAttribute('title') || '');
        return /^(?:show|expand|more|view)$/i.test(text);
      });

      for (const trigger of candidates.slice(0, 2)) {
        dispatchUserLikeClick(trigger);
        await sleep(TIMING.INPUT_WRITE_SETTLE_MS);
        if (root.querySelector('.twixi-wrap.verbose .flooded, .twixi-wrap.verbose')) return true;
      }
    }

    return false;
  }

  async function findAemPagePaths(settings) {
    let expanded = false;
    if (settings.autoExpandAemPagePath !== false) {
      expanded = await expandAemPagePathField();
    }

    const result = findAemPagePathsFromDom(settings);
    if (expanded && result.lines.length) {
      return {
        ...result,
        note: `${result.note} AEM Page Path was expanded before counting.`
      };
    }
    if (expanded && !result.lines.length) {
      return {
        ...result,
        note: `${result.note} AEM Page Path expand was attempted but no lines were counted.`
      };
    }
    return result;
  }

  function issueLabelSelectors(settings) {
    return [
      settings.issueLabelsSelector,
      '#wrap-labels .labels a.lozenge',
      '#wrap-labels ul.labels a',
      'ul.labels a.lozenge',
      '[id^="labels-"][id$="-value"] a',
      '#labels-val a'
    ].filter(Boolean);
  }

  function detectIssueLabels(settings = {}) {
    const seen = new Set();
    const labels = [];

    for (const selector of [...new Set(issueLabelSelectors(settings))]) {
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        continue;
      }

      for (const element of elements) {
        const raw = element.getAttribute('title')
          || element.querySelector('span')?.textContent
          || element.textContent
          || '';
        const text = normaliseText(raw);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(text);
      }
    }

    return labels;
  }

  function findQuantityField(settings, options = {}) {
    const includeEditInputs = options.includeEditInputs === true;
    const selectors = [
      settings.quantityViewSelector,
      '#customfield_13618-val',
      '[id="customfield_13618-val"]'
    ].filter(Boolean);

    if (includeEditInputs) {
      selectors.push(
        settings.quantityInputSelector,
        'input#customfield_13618',
        'input[name="customfield_13618"]'
      );
    }

    let invalidSelector = '';
    for (const selector of [...new Set(selectors)]) {
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)];
      } catch {
        invalidSelector = selector;
        continue;
      }

      for (const element of elements) {
        if (!includeEditInputs && isInsideEditIssueContainer(element)) continue;
        const token = extractQuantityToken(readElementValue(element));
        if (token !== '') {
          return { value: token, note: `Read Quantity from ${selector}.` };
        }
      }
    }

    const labels = findExactLabelElements(settings.quantityLabel || 'Quantity');
    for (const label of labels) {
      if (!includeEditInputs && isInsideEditIssueContainer(label)) continue;

      if (label.tagName === 'LABEL') {
        const forId = label.getAttribute('for');
        const linked = forId ? document.getElementById(forId) : null;
        if (linked && (includeEditInputs || !isInsideEditIssueContainer(linked))) {
          const linkedToken = extractQuantityToken(readElementValue(linked));
          if (linkedToken !== '') {
            return { value: linkedToken, note: 'Read Quantity from the input linked to its label.' };
          }
        }
      }

      let sibling = label.nextElementSibling;
      for (let count = 0; sibling && count < 3; count += 1, sibling = sibling.nextElementSibling) {
        if (!includeEditInputs && isInsideEditIssueContainer(sibling)) continue;
        const siblingToken = extractQuantityToken(readElementValue(sibling));
        if (siblingToken !== '') {
          return { value: siblingToken, note: 'Read Quantity from the field label’s next sibling.' };
        }
      }
    }

    return {
      value: '',
      note: invalidSelector
        ? `Quantity selector “${invalidSelector}” is invalid.`
        : 'Quantity was not visible on the issue view; the Edit Issue field will be used for validation and correction.'
    };
  }

  Object.assign(Content, {
    extractDateToken,
    findDateField,
    findDirectDateCandidate,
    findExactLabelElements,
    extractValueNearLabel,
    findAemPagePaths,
    findQuantityField,
    detectIssueLabels
  });
})();
