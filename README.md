# JIRA Due Date and Quantity Fixer

Chrome Manifest V3 extension that processes Samsung Jira tickets sequentially through the authenticated web interface. It does not use Jira REST APIs, external APIs, or AI.

## Version 1.10.0 Quantity replacement fix

- Existing non-empty Quantity values are explicitly cleared and replaced with the AEM Page Path count.
- Only an input inside Jira's active Edit Issue dialog/form is treated as editable Quantity.
- The extension submits the edit using the normal Update control and falls back to `form.requestSubmit()` when Jira ignores the synthetic click.
- Save verification never treats the still-open edit input as a persisted value.
- The verified persisted Quantity takes precedence over temporarily stale issue-view markup.
- The Results **Quantity** column shows the final verified saved value, for example `3 · UPDATED`.

## Version 1.10.0 behavior

For each ticket, the extension performs two independent validations.

### 1. Due date validation

1. Reads **Live Date** from `#customfield_16801-val time`.
2. Reads **Due** from `#due-date time`.
3. Requires **Due >= Live Date + 2 calendar days**.
4. When the value is incorrect, it uses Jira inline editing and the **Edit Issue** fallback to update and verify Due.

### 2. AEM Page Path and Quantity validation

1. Reads only the verbose AEM Page Path content from:

```css
#customfield_14002-val .twixi-wrap.verbose .flooded
```

2. Converts `<br>` elements and block boundaries into line breaks.
3. Counts non-empty lines only.
4. Ignores Jira's duplicate concise rendering, so each page path is counted once.
5. Reads Quantity from the issue view using `#customfield_13618-val` when available.
6. If Quantity is empty, unreadable, or different from the AEM Page Path line count, it opens **Edit Issue** and updates:

```css
#customfield_13618
```

7. Submits Jira's Update/Save control and verifies the persisted Quantity. If the issue view does not expose Quantity, the extension reopens Edit Issue and verifies the saved input value there.

## Counting example

Given:

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

The calculated Quantity is `3`.

- Existing Quantity `3`: **3 · PASS**
- Existing Quantity `2`: Jira is updated to `3`, then Results shows **3 · UPDATED**
- Quantity cannot be saved: Results shows the current and expected values with **FAIL**
- AEM Page Path cannot be read: Results shows **ERROR**

## Results table

The Results table contains:

- **Ticket**: Jira issue link.
- **Due**: final Due date.
- **Live Date**: extracted Live Date.
- **Date**: PASS, PASS · UPDATED, FAIL, or ERROR.
- **Quantity**:
  - `<count> · PASS` when Quantity already matches the AEM Page Path count.
  - `<count> · UPDATED` when Jira was corrected and verified.
  - `<current> / <expected> · FAIL` when correction fails.
  - `ERROR` when the AEM Page Path count cannot be determined.

CSV export includes all date fields, AEM Page Path lines, original/final Quantity values, update status, update messages, errors, and processing timestamp.

## Default selectors

- Due view: `#due-date time`
- Live Date view: `#customfield_16801-val time`
- AEM Page Path verbose content: `#customfield_14002-val .twixi-wrap.verbose .flooded`
- Quantity issue view: `#customfield_13618-val`
- Quantity Edit Issue input: `#customfield_13618`

These selectors can be adjusted in **Validation settings** without changing source code.


## Race-condition and Jira dead-link fix

Version 1.10.0 does not edit any field immediately after Chrome reports that the tab is complete. It now:

1. Verifies that the tab is on the exact requested `/browse/<ticket>` URL.
2. Waits for three stable page samples, the Jira issue shell, Due, Live Date, and AEM Page Path fields.
3. Confirms that Jira's AJS/JIRA application code is initialized before clicking editable controls.
4. Waits an additional quiet period so Jira cannot replace the field DOM during the first edit.
5. Restricts Edit Issue detection to Jira's actual issue-operation controls.
6. Prevents an Edit Issue anchor's default navigation while still allowing Jira's JavaScript dialog handler to run.
7. Detects the exact `Oops, you've found a dead link` page and retries the ticket once using its canonical URL.
8. Revalidates page readiness after saving Due and before opening Edit Issue for Quantity.
9. Stops safely with an error instead of clicking fields when the issue page is incomplete or has navigated elsewhere.

The extension intentionally opens Quantity through Edit Issue rather than using an arbitrary page-level input. This avoids selecting stale or hidden fields while Jira is still rendering.

## Installation or upgrade

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. For a new installation, click **Load unpacked** and select the extracted `jira-due-live-validator` folder.
5. For an existing installation, replace the old folder and click **Reload**.
6. Confirm that the extension card shows version `1.10.0`.
7. Sign in to `https://jira.secext.samsung.net/` before running validation.
8. Run the ticket list again. Older stored results are cleared during upgrade.

Do not load the ZIP directly; extract it first.

## Permissions and update failures

Automatic updates require the logged-in Jira user to have permission to edit the issue and the applicable fields. Jira screen configuration, workflow restrictions, field validators, and permissions are not bypassed.

When Quantity cannot be updated, the CSV contains the current value, calculated target, submitted value, Jira update status, update message, and any detected error.

## Security

- Data remains in `chrome.storage.local`.
- Host access is restricted to `https://jira.secext.samsung.net/*`.
- Credentials are not read or stored.
- No data is sent outside the browser.
- Distribute the extension through your organization's approved extension process.
