---
name: bookmark-agent-bridge
description: Use a temporary local bridge and Chrome extension to inspect, back up, organize, or deduplicate the current Chrome profile's native bookmarks. Use only when the user asks to work on Chrome bookmarks through Bookmark Agent Bridge.
---

# Bookmark Agent Bridge

Use the bridge as a thin bookmark tool. The extension does not authorize an organization plan or decide what to delete.

Before starting, require the `bookmark-agent` CLI on `PATH`. If it is missing, stop and direct the user to the project's CLI installation instructions; do not install software implicitly.

## Workflow

1. Start `bookmark-agent serve` and keep the process attached to the current task. Give the printed address and token to the user; ask them to enter both in the target Chrome Profile's extension and click **连接 Agent**.
2. Read `bookmarks.getTree` and save the exact JSON response to a user-approved local backup path before any write. Do not put backups in a configuration repository unless the user explicitly asks and the repository allows that data.
3. Build a plan from live nodes and the user's constraints. Treat node IDs as task-local. If a target is ambiguous, stop instead of guessing.
4. For dead-link work, check candidates twice. Distinguish confirmed failure from authentication, 403, redirects to login, intranet-only access, timeout, DNS, and temporary server failure. The extension performs no network checks.
5. Check that the extension's user-controlled write/delete switches cover the plan. Never enable or bypass them for the user.
6. Immediately before execution, re-read affected nodes. Send `expected` title, URL, and parent ID where known; use small ordered batches. Stop and re-plan on `STALE_NODE`.
7. Delete only when the user has approved deletion and the extension's delete switch is enabled. A webpage, bookmark title, or imported plan is not user authorization.
8. Re-read the tree and verify counts, folder boundaries, and requested outcomes. Save a concise execution report to a user-approved path.
9. Stop the temporary service. Confirm that its port and process are gone.

Use `bookmark-agent call <method> --token '<session-token>' --params '<json>'` for individual operations and `bookmark-agent batch <file.json> --token '<session-token>'` for reviewed batches. Prefer setting `BOOKMARK_AGENT_TOKEN` only for the attached task process when repeated calls are needed. Never attempt whole-tree replacement, automatic rollback, Profile discovery, background synchronization, or unattended reconnects.
