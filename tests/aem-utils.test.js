'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../lib/dom-utils');
require('../lib/aem-utils');

const {
  extractNonEmptyLines,
  parseQuantity,
  validateQuantity,
  resolveExpectedQuantity,
  computeQuantityLabelBonus
} = require('../lib/aem-utils');

test('extractNonEmptyLines counts a single inline AEM path once', () => {
  const dom = new JSDOM('<div class="flooded">/content/site/en/page</div>');
  const element = dom.window.document.querySelector('.flooded');
  assert.deepEqual(extractNonEmptyLines(element), ['/content/site/en/page']);
});

test('extractNonEmptyLines strips show prefix from a compact single path line', () => {
  const dom = new JSDOM('<div>show /content/site/en/page</div>');
  const element = dom.window.document.querySelector('div');
  assert.deepEqual(extractNonEmptyLines(element), ['/content/site/en/page']);
});

test('extractNonEmptyLines counts br-separated paths once', () => {
  const dom = new JSDOM(`
    <div id="customfield_14002-val">
      <div class="twixi-wrap verbose">
        <div class="flooded">
          /path-one<br>
          /path-two<br>
          /path-three
        </div>
      </div>
    </div>
  `);
  const element = dom.window.document.querySelector('.flooded');
  assert.deepEqual(extractNonEmptyLines(element), ['/path-one', '/path-two', '/path-three']);
});

test('extractNonEmptyLines ignores hide/show toggle text', () => {
  const dom = new JSDOM('<div>show<br>/path-one<br>hide</div>');
  const element = dom.window.document.querySelector('div');
  assert.deepEqual(extractNonEmptyLines(element), ['/path-one']);
});

test('extractNonEmptyLines trims zero-width characters', () => {
  const dom = new JSDOM('<div>/path-one\u200B<br>\uFEFF/path-two</div>');
  const element = dom.window.document.querySelector('div');
  assert.deepEqual(extractNonEmptyLines(element), ['/path-one', '/path-two']);
});

test('extractNonEmptyLines counts site root slash as its own path line', () => {
  const dom = new JSDOM('<div>/</div>');
  const element = dom.window.document.querySelector('div');
  assert.deepEqual(extractNonEmptyLines(element), ['/']);
});

test('extractNonEmptyLines counts home path and nested path together', () => {
  const dom = new JSDOM(`
    <div class="flooded">
      /<br>
      /smartphones/all-smartphones/
    </div>
  `);
  const element = dom.window.document.querySelector('.flooded');
  assert.deepEqual(extractNonEmptyLines(element), ['/', '/smartphones/all-smartphones/']);
  assert.equal(validateQuantity(2, extractNonEmptyLines(element).length).status, 'PASS');
});

test('parseQuantity accepts plain numeric values', () => {
  assert.equal(parseQuantity('3'), 3);
  assert.equal(parseQuantity('Quantity: 12'), 12);
  assert.equal(parseQuantity(''), null);
});

test('validateQuantity reports PASS, FAIL, and ERROR states', () => {
  assert.equal(validateQuantity(3, 3).status, 'PASS');
  assert.equal(validateQuantity(1, 1).status, 'PASS');
  assert.equal(validateQuantity(2, 3).status, 'FAIL');
  assert.equal(validateQuantity(null, 0).status, 'ERROR');
  assert.equal(validateQuantity(null, 3).status, 'FAIL');
  assert.match(validateQuantity(null, 0).message, /Expand AEM Page Path/i);
});

test('resolveExpectedQuantity adds gnb label bonus to AEM path count', () => {
  const rules = [{ label: 'gnb', bonus: 1 }];
  assert.deepEqual(resolveExpectedQuantity(3, ['bhavana.s', 'gnb'], rules), {
    pathLineCount: 3,
    labelBonus: 1,
    expectedQuantity: 4,
    matchedLabels: ['gnb']
  });
  assert.deepEqual(resolveExpectedQuantity(0, ['gnb'], rules), {
    pathLineCount: 0,
    labelBonus: 1,
    expectedQuantity: 1,
    matchedLabels: ['gnb']
  });
  assert.equal(resolveExpectedQuantity(2, ['other'], rules).expectedQuantity, 2);
});

test('validateQuantity explains label bonus in messages', () => {
  const result = validateQuantity(4, 4, {
    aemPathLineCount: 3,
    labelBonus: 1,
    matchedLabels: ['gnb']
  });
  assert.equal(result.status, 'PASS');
  assert.match(result.message, /gnb/i);
  assert.match(result.message, /\+ 1/);
});

test('computeQuantityLabelBonus is case-insensitive', () => {
  const rules = [{ label: 'gnb', bonus: 1 }];
  assert.equal(computeQuantityLabelBonus(['GNB'], rules).bonus, 1);
});
