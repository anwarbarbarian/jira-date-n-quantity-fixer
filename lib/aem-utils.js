'use strict';

(function attachAemUtils(root, factory) {
  const api = factory(root.JiraValidator || {});
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.JiraValidator = root.JiraValidator || {};
    Object.assign(root.JiraValidator, api);
  }
})(typeof globalThis !== 'undefined' ? globalThis : global, function createAemUtils(deps) {
  const { normaliseText = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() } = deps;

  function readDomTextWithBreaks(root) {
    let output = '';
    const blockTags = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET',
      'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
      'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
      'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
    ]);

    const appendBreak = () => {
      if (output && !output.endsWith('\n')) output += '\n';
    };

    const visit = (node) => {
      if (node.nodeType === 3) {
        output += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.tagName;
      if (tag === 'BR' || tag === 'HR') {
        appendBreak();
        return;
      }

      const isBlock = blockTags.has(tag);
      if (isBlock) appendBreak();
      for (const child of node.childNodes) visit(child);
      if (isBlock) appendBreak();
    };

    visit(root);
    return output;
  }

  function cleanAemPathLine(line) {
    return String(line || '')
      .replace(/^(?:show|hide)\s+/i, '')
      .replace(/\s+(?:show|hide)$/i, '')
      .trim();
  }

  function isLikelyAemPathLine(line) {
    if (!line) return false;
    if (line === '/') return true;
    if (/^\/\S/.test(line)) return true;
    if (/^https?:\/\//i.test(line)) return true;
    return /\/content\/|\/dam\/|\/etc\//i.test(line);
  }

  function finalizeAemPathLines(lines) {
    const cleaned = lines
      .map(cleanAemPathLine)
      .filter((line) => line && !/^(?:hide|show)$/i.test(line));
    const pathLike = cleaned.filter(isLikelyAemPathLine);
    return pathLike.length ? pathLike : cleaned;
  }

  function extractNonEmptyLines(element) {
    const tag = String(element?.tagName || '').toUpperCase();
    const raw = tag === 'INPUT' || tag === 'TEXTAREA'
      ? String(element.value || '')
      : readDomTextWithBreaks(element);

    const lines = raw
      .replace(/\r/g, '\n')
      .split(/\n+/)
      .map((line) => line
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim())
      .filter((line) => line && !/^(?:hide|show)$/i.test(line));

    return finalizeAemPathLines(lines);
  }

  function extractQuantityToken(value) {
    const text = normaliseText(value);
    if (!text) return '';
    if (/^\d+$/.test(text)) return text;
    const match = text.match(/(?:^|\b)(\d+)(?:\b|$)/);
    return match ? match[1] : '';
  }

  function parseQuantity(value) {
    const token = extractQuantityToken(value);
    if (token === '') return null;
    const quantity = Number(token);
    return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
  }

  function normaliseIssueLabel(value) {
    return normaliseText(value).toLowerCase();
  }

  function computeQuantityLabelBonus(labels, bonusRules = []) {
    const labelSet = new Set(
      (Array.isArray(labels) ? labels : [])
        .map((label) => normaliseIssueLabel(label))
        .filter(Boolean)
    );
    let bonus = 0;
    const matchedLabels = [];
    for (const rule of bonusRules) {
      const ruleLabel = normaliseIssueLabel(rule?.label);
      const ruleBonus = Number(rule?.bonus);
      if (!ruleLabel || !Number.isFinite(ruleBonus) || ruleBonus <= 0) continue;
      if (!labelSet.has(ruleLabel)) continue;
      bonus += Math.round(ruleBonus);
      matchedLabels.push(String(rule.label || ruleLabel).trim());
    }
    return { bonus, matchedLabels };
  }

  function resolveExpectedQuantity(pathLineCount, labels, bonusRules = []) {
    const base = Number.isSafeInteger(pathLineCount) && pathLineCount >= 0 ? pathLineCount : 0;
    const { bonus, matchedLabels } = computeQuantityLabelBonus(labels, bonusRules);
    return {
      pathLineCount: base,
      labelBonus: bonus,
      expectedQuantity: base + bonus,
      matchedLabels
    };
  }

  function formatExpectedQuantitySource(pathLineCount, labelBonus, matchedLabels = []) {
    const paths = Number.isSafeInteger(pathLineCount) && pathLineCount >= 0 ? pathLineCount : 0;
    if (!labelBonus) {
      return `${paths} AEM Page Path line${paths === 1 ? '' : 's'}`;
    }
    const labelHint = matchedLabels.length
      ? matchedLabels.join(', ')
      : 'label bonus';
    return `${paths} AEM Page Path line${paths === 1 ? '' : 's'} + ${labelBonus} (${labelHint})`;
  }

  function validateQuantity(quantity, expectedQuantity, options = {}) {
    const pathLineCount = Number.isSafeInteger(options.aemPathLineCount)
      ? options.aemPathLineCount
      : null;
    const labelBonus = Number.isSafeInteger(options.labelBonus) ? options.labelBonus : 0;
    const matchedLabels = Array.isArray(options.matchedLabels) ? options.matchedLabels : [];
    const sourceText = pathLineCount === null
      ? 'AEM Page Path'
      : formatExpectedQuantitySource(pathLineCount, labelBonus, matchedLabels);

    if (!Number.isSafeInteger(expectedQuantity) || expectedQuantity <= 0) {
      return {
        status: 'ERROR',
        message: 'No non-empty AEM Page Path lines were found, so Quantity could not be validated. Expand AEM Page Path on the issue or check the AEM selector in settings.'
      };
    }
    if (!Number.isSafeInteger(quantity)) {
      return {
        status: 'FAIL',
        message: `Quantity is empty or unreadable; expected ${expectedQuantity} from ${sourceText}.`
      };
    }
    if (quantity === expectedQuantity) {
      return {
        status: 'PASS',
        message: `Quantity ${quantity} matches expected ${expectedQuantity} (${sourceText}).`
      };
    }
    return {
      status: 'FAIL',
      message: `Quantity ${quantity} does not match expected ${expectedQuantity} (${sourceText}).`
    };
  }

  return {
    readDomTextWithBreaks,
    extractNonEmptyLines,
    cleanAemPathLine,
    isLikelyAemPathLine,
    finalizeAemPathLines,
    extractQuantityToken,
    parseQuantity,
    computeQuantityLabelBonus,
    resolveExpectedQuantity,
    formatExpectedQuantitySource,
    validateQuantity
  };
});
