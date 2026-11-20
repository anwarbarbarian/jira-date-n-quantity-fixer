# Mark Tickets Complete

Chrome Manifest V3 extension that processes Samsung Jira tickets sequentially through the authenticated web interface. It does not use Jira REST APIs, external APIs, or AI.

Current extension version: **1.0.2** (see `manifest.json`).

## How you run it

1. Click the extension icon. Each click opens a **dashboard** tab (`dashboard.html`); there is no browser action popup.
2. Paste ticket keys or browse URLs, adjust **Validation settings** if needed, then **Start validation**.
3. The ticket list is saved while you edit it and is only cleared when you click **Clear** (not when a run starts).
4. **Stop** ends the queue; **Export CSV** downloads detailed results.

Sign in to `https://jira.secext.samsung.net/` before starting. The extension opens each issue in a tab and automates the same UI actions you would use manually.

## What it validates

For each ticket, Due date and Quantity are handled independently. Either check can **PASS**, **PASS · UPDATED**, **FAIL**, **ERROR**, or **SKIPPED** depending on fields, issue type, and settings.

### 1. Due date (Live Date + 2 calendar days)

1. Reads **Live Date** from the issue view (`#customfield_16801-val time` by default).
2. Reads **Due** from `#due-date time`.
3. Applies the rule **Due ≥ Live Date + 2 calendar days** (comparison uses calendar days in UTC).
4. When auto-update is enabled and the rule fails (typically Due is too early), the extension updates Due via inline editing and, when needed, the **Edit Issue** dialog, then verifies the saved value.
5. Optional setting: only auto-update when Due is **before** Live + 2 days; later Due dates are left unchanged.

**Live Date from issue history (optional, on by default):** if Live Date is missing or unreadable on the view, the extension can open **History**, find the **READY FOR LIVE → LIVE** status change, and use that timestamp as Live Date for validation. When **Write inferred Live Date** is enabled, it can set Live Date on the issue (including a combined **Edit Issue** update of Live Date and Due) before correcting Due.

**When Due validation is skipped (no auto-update):**

| Condition | Result |
|-----------|--------|
| Issue type is in the default skip list (**PDP Publishing Request**) | SKIPPED for Due rule and Due auto-update |
| **AEM Page Publish Time** is present on the issue (scheduled tickets) | SKIPPED when *Skip Due date rule when AEM Page Publish Time is on the issue* is enabled |
| Due or Live Date field missing from the issue view | SKIPPED when the corresponding “skip when missing” options are enabled |
| Auto-update Due disabled in settings | Validation may still run; correction is not attempted |

Issue type names are matched after normalising Jira’s display text (for example long `img[title]` descriptions map to **PDP Publishing Request**).

### 2. AEM Page Path and Quantity

1. Requires the **AEM Page Path** field on the issue view (`#customfield_14002-val`). If that field is **not** on the screen, **Quantity validation and auto-update are skipped** for all issue types (the extension does not substitute a fixed Quantity).
2. Reads verbose AEM content from the configured selector (default: `#customfield_14002-val .twixi-wrap .flooded`).
3. Optionally expands collapsed AEM Page Path before counting.
4. Counts **non-empty lines** only (each path once; duplicate concise/verbose renderings are not double-counted).
5. Adds label bonuses before comparison (default: **`gnb` label → +1** to the expected count).
6. Reads Quantity from the issue view (`#customfield_13618-val`) when visible.
7. If Quantity is empty, wrong, or unreadable on the view, it opens **Edit Issue**, sets `#customfield_13618`, submits **Update**, and verifies the persisted value (reopening Edit Issue when the view does not refresh).

**When Quantity is skipped:**

| Condition | Result |
|-----------|--------|
| Issue type **PDP Publishing Request** (default) | SKIPPED — AEM and Quantity rules not applied |
| AEM Page Path field not on the issue view | SKIPPED — no validation or auto-update |

For other issue types (including **Static Page WSC Production**), Quantity still depends on AEM Page Path being present; missing AEM means **SKIPPED**, not a default Quantity of 1.

### Quantity update behaviour

- Existing non-empty Quantity values are cleared and replaced with the calculated AEM line count (plus label bonus).
- Only an input inside Jira’s active **Edit Issue** dialog is treated as the editable Quantity field.
- Save uses the normal **Update** control, with `form.requestSubmit()` and related fallbacks when Jira ignores synthetic clicks.
- Verified persisted Quantity takes precedence over stale issue-view markup. Results show values like `3 · UPDATED`.

## Counting example

```html
<div id="customfield_14002-val">
  <div class="twixi-wrap verbose">
    <div class="flooded">
      /path-one<br>
      /path-two<br>
      /path-three
    </div>
  </div>
</div>
```

Expected Quantity is **3** (plus any configured label bonus).

- Quantity already `3`: **3 · PASS**
- Quantity `2`: corrected to `3`, then **3 · UPDATED**
- Update fails: **&lt;current&gt; / &lt;expected&gt; · FAIL**
- AEM lines cannot be read: **ERROR**
- AEM field absent or PDP issue type: **SKIPPED**

## Results table and CSV

**Columns:** Ticket link, Due, Live Date, Date status, Quantity status.

CSV export includes date fields, AEM path lines, original/final Quantity, update status and messages, issue labels, errors, and processing timestamp.

## Page readiness and stability

The extension does not edit fields as soon as the tab fires `complete`. For each ticket it:

1. Confirms the URL is the requested `/browse/<ticket>`.
2. Waits for stable DOM samples and the Jira issue shell (Due/Live optional unless you require them in settings).
3. Waits for AJS/JIRA to initialise before clicking editable controls.
4. Uses a short quiet period so Jira does not replace field DOM mid-edit.
5. Limits **Edit Issue** detection to real issue-operation controls and avoids dead-link navigation side effects.
6. Detects Jira’s **dead link** page and retries once on the canonical URL.
7. Re-checks readiness after saving Due and before opening Edit Issue for Quantity.
8. Fails safely with an error instead of clicking when the page is incomplete or navigated away.

Quantity updates always go through **Edit Issue** rather than arbitrary page-level inputs, to avoid stale or hidden fields during render.

## Default selectors and issue-type lists

| Purpose | Default |
|---------|---------|
| Due (view) | `#due-date time` |
| Live Date (view) | `#customfield_16801-val time` |
| AEM Page Publish Time | `#customfield_14005-val` |
| AEM Page Path (verbose) | `#customfield_14002-val .twixi-wrap .flooded` |
| Quantity (view) | `#customfield_13618-val` |
| Quantity (Edit Issue) | `#customfield_13618` |
| Issue labels | `#wrap-labels .labels a.lozenge` |

View selectors and most behaviour flags are editable in the dashboard **Validation settings**. Issue-type skip lists (`quantitySkippedIssueTypes`, `dueDateSkippedIssueTypes`, `aemOptionalIssueTypes`) are defined in `lib/settings-utils.js` and migrate with stored settings version **22**; change defaults there if your Jira project uses different type names.

## Installation or upgrade

1. Extract the release ZIP into a permanent folder (do not load the ZIP directly in Chrome).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** and select the project folder, or **Reload** after replacing an existing copy.
4. Confirm the extension card shows version **1.0.2**.
5. Sign in to Jira, then open the dashboard from the toolbar icon and run your list again.

On extension **update**, stored validation results are cleared so old output is not mistaken for a new run.

## Permissions and limits

Automatic updates require the logged-in user to have permission to edit the issue and the relevant fields. Jira workflows, validators, screen configuration, and permissions are not bypassed.

When an update fails, the CSV and result messages include current values, targets, submission details, and Jira error text where available.

## Development

```bash
npm install
npm test
npm run validate
```

Tests use Node’s built-in test runner and `jsdom` for DOM-oriented helpers.

## Security

- State and results stay in `chrome.storage.local`.
- Host access is limited to `https://jira.secext.samsung.net/*`.
- Credentials are not read or stored.
- No data is sent outside the browser.
- Distribute through your organisation’s approved extension process.