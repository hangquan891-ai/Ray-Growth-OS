# Extension automation workflow QA

## Scope

- App source-link click automatically associates the clicked queue item with the extension.
- The App's saved X profile is forwarded as the extension username when available.
- The user can publish a reply on X without keeping the popup open.
- The extension captures the user's reply URL and writes it back to the App.
- Popup actions are recovery and inspection tools, not required steps in the normal flow.

## Help and popup copy

- The popup no longer exposes a "从 App 读取队列" action.
- The popup states that automatic listening is enabled and that it does not need to stay open.
- The help page explicitly says that opening the source from the App automatically associates the item and does not require manual queue reading.
- The help page keeps recovery, patrol, and stored-feedback write-back as fallback operations.

## Validation

- Browser readback of `/help#plugin` confirmed the automatic-flow copy is rendered.
- Extension workflow tests cover source association, username synchronization, duplicate-safe upsert, reply URL capture, and removal of the manual sync control.
- Type checking, unit tests, production build, JavaScript syntax checks, and `git diff --check` are required before handoff.

Final result: passed.
