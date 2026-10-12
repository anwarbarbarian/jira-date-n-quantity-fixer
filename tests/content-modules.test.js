'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scriptChain = manifest.content_scripts[0].js;

function loadExtensionScripts() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://jira.secext.samsung.net/browse/ABC-1'
  });

  const sandbox = {
    globalThis: {},
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async () => ({ ok: true, result: { success: true, ready: true } })
      }
    }
  };

  sandbox.globalThis = sandbox;
  sandbox.window = dom.window;
  sandbox.document = dom.window.document;
  sandbox.location = dom.window.location;
  sandbox.navigator = dom.window.navigator;
  sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  sandbox.HTMLElement = dom.window.HTMLElement;
  sandbox.Element = dom.window.Element;
  sandbox.HTMLInputElement = dom.window.HTMLInputElement;
  sandbox.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  sandbox.InputEvent = dom.window.InputEvent;
  sandbox.KeyboardEvent = dom.window.KeyboardEvent;
  sandbox.FocusEvent = dom.window.FocusEvent;
  sandbox.MouseEvent = dom.window.MouseEvent;
  sandbox.PointerEvent = dom.window.PointerEvent;
  sandbox.Event = dom.window.Event;

  const context = vm.createContext(sandbox);

  for (const relativePath of scriptChain) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
  }

  return sandbox;
}

test('content script chain registers the expected analyser API', () => {
  const sandbox = loadExtensionScripts();
  const content = sandbox.globalThis.JiraValidatorContent;

  assert.ok(content, 'JiraValidatorContent namespace should exist');
  assert.equal(typeof content.analyseTicket, 'function');
  assert.equal(typeof content.waitForPage, 'function');
  assert.equal(typeof content.findDateField, 'function');
  assert.equal(typeof content.updateQuantityViaUi, 'function');
  assert.equal(typeof globalThis.__jiraDateValidatorLoaded, 'undefined');
  assert.equal(sandbox.globalThis.__jiraDateValidatorLoaded, true);
});

test('shared libraries expose timing and settings helpers', () => {
  const sandbox = loadExtensionScripts();
  const jv = sandbox.globalThis.JiraValidator;

  assert.equal(jv.STABLE_SAMPLE_COUNT, 3);
  assert.equal(jv.COMPARISON_RULE, 'due_exactly_two_days_after_live');
  assert.equal(typeof jv.parseDate, 'function');
  assert.equal(typeof jv.fieldPresent, 'function');
  assert.equal(typeof sandbox.globalThis.JiraValidatorInputWriter.writeInputValue, 'function');
});

test('detectIssueTypeName reads img title and strips description suffix', () => {
  const sandbox = loadExtensionScripts();
  sandbox.document.body.innerHTML = `
    <span id="type-val" class="value">
      <img src="/issuetype.png" title="PDP Publishing Request - To request publishing of a PDP" alt="">
    </span>
  `;

  assert.equal(
    sandbox.globalThis.JiraValidatorContent.detectIssueTypeName(),
    'PDP Publishing Request'
  );
});

test('buildErrorResult marks Quantity SKIPPED for PDP when readiness fails', () => {
  const sandbox = loadExtensionScripts();
  const content = sandbox.globalThis.JiraValidatorContent;
  const { sanitiseSettings } = sandbox.globalThis.JiraValidator;
  const settings = sanitiseSettings({ settingsVersion: 21 });

  sandbox.document.body.innerHTML = `
    <span id="type-val" class="value">
      <img title="PDP Publishing Request - Description" alt="">
    </span>
  `;

  const result = content.buildErrorResult('PAGE_NOT_READY', 'AEM Page Path field was not found.', settings);

  assert.equal(result.issueTypeName, 'PDP Publishing Request');
  assert.equal(result.quantityStatus, 'SKIPPED');
  assert.equal(result.quantityValidationSkipped, true);
  assert.equal(result.quantityUpdateStatus, 'NOT_APPLICABLE');
  assert.equal(result.dateStatus, 'ERROR');
});

test('detectIssueLabels reads lozenge labels from wrap-labels markup', () => {
  const sandbox = loadExtensionScripts();
  sandbox.document.body.innerHTML = `
    <div id="wrap-labels">
      <ul class="labels" id="labels-8333712-value">
        <li><a class="lozenge" href="/issues/?jql=labels+%3D+gnb" title="gnb"><span>gnb</span></a></li>
        <li><a class="lozenge" href="/issues/?jql=labels+%3D+bhavana.s" title="bhavana.s"><span>bhavana.s</span></a></li>
      </ul>
    </div>
  `;
  const labels = sandbox.globalThis.JiraValidatorContent.detectIssueLabels({});
  assert.deepEqual([...labels].sort(), ['bhavana.s', 'gnb']);
});

test('Static Page uses fixed Quantity only when AEM Page Path field is absent', () => {
  const sandbox = loadExtensionScripts();
  const content = sandbox.globalThis.JiraValidatorContent;
  const { sanitiseSettings } = sandbox.globalThis.JiraValidator;
  const settings = sanitiseSettings({ settingsVersion: 21 });

  sandbox.document.body.innerHTML = `
    <span id="type-val" class="value">Static Page WSC Production</span>
  `;
  const withoutAem = content.buildErrorResult('PAGE_NOT_READY', 'Not ready.', settings);
  assert.equal(withoutAem.quantityUsesFixedIssueTypeRule, true);

  sandbox.document.body.innerHTML = `
    <span id="type-val" class="value">Static Page WSC Production</span>
    <div id="customfield_14002-val"><div class="flooded">/content/site/home</div></div>
  `;
  const withAem = content.buildErrorResult('PAGE_NOT_READY', 'Not ready.', settings);
  assert.equal(withAem.quantityUsesFixedIssueTypeRule, false);
});
