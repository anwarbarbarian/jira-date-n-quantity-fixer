'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let writeInputValue;
let prepareLiveDateInputForEdit;

before(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.FocusEvent = dom.window.FocusEvent;
  globalThis.Event = dom.window.Event;

  delete require.cache[require.resolve('../lib/input-writer.js')];
  const inputWriter = require('../lib/input-writer');
  writeInputValue = inputWriter.writeInputValue;
  prepareLiveDateInputForEdit = inputWriter.prepareLiveDateInputForEdit;
});

test('writeInputValue clears an existing value before writing the replacement', () => {
  const dom = new JSDOM('<input type="text" value="2">');
  const input = dom.window.document.querySelector('input');

  const observed = writeInputValue(input, '3');
  assert.equal(observed, '3');
  assert.equal(input.value, '3');
});

test('writeInputValue enables disabled Live Date input before writing', () => {
  const dom = new JSDOM(`
    <input class="text medium-field datepicker-input clientreadonly"
      id="customfield_16801" name="customfield_16801" type="text" value="" disabled>
  `);
  const input = dom.window.document.querySelector('input');
  assert.equal(input.disabled, true);

  prepareLiveDateInputForEdit(input);
  assert.equal(input.disabled, false);
  assert.equal(input.hasAttribute('disabled'), false);
  assert.equal(input.classList.contains('clientreadonly'), false);

  const observed = writeInputValue(input, '01/Oct/26 6:31 PM');
  assert.equal(observed, '01/Oct/26 6:31 PM');
});

test('writeInputValue replaces non-empty textarea content exactly', () => {
  const dom = new JSDOM('<textarea>old-line-1\nold-line-2</textarea>');
  const textarea = dom.window.document.querySelector('textarea');

  const observed = writeInputValue(textarea, '5');
  assert.equal(observed, '5');
  assert.equal(textarea.value, '5');
});
