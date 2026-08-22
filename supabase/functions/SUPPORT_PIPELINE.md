# SmartCore automated support pipeline

Customer reports a bug at `/issues` → AI support agent triages it → if it's a
genuine defect, a fix agent writes the change → a reviewer agent decides whether
it's safe → approved changes merge to `main` (which Cloudflare Pages deploys) →
the customer is told their fix is live.

## Required setup

Two secrets must be set in **Supabase → Project Settings → Edge Functions →
Secrets**. Nothing works without them; the pipeline fails closed and escalates
every ticket to a human until they're present.

| Secret | What it is | Needed by |
|---|---|---|
| `AI-CODE-FIXER-API-KEY` | Anthropic API key | `support-chat`, `support-pipeline` |
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope on `finleyhsl23/smartcoretechnology` | `support-pipeline` |

If your secret store rejects hyphens in a name, use `AI_CODE_FIXER_API_KEY`
instead — both functions read the hyphenated name first and fall back to the
underscore form.

Optional overrides (all have sensible defaults):

| Secret | Default |
|---|---|
| `SUPPORT_REPO` | `finleyhsl23/smartcoretechnology` |
| `SUPPORT_BASE_BRANCH` | `main` |
| `SUPPORT_CHAT_MODEL` | `claude-sonnet-5` |
| `SUPPORT_FIX_MODEL` | `claude-opus-5` |
| `SUPPORT_REVIEW_MODEL` | `claude-opus-5` |

## The three functions

### `support-chat` (verify_jwt: true)
The customer-facing agent. Presents as a named person from the roster in
`support_agents`, resolves the caller's company and purchased modules for
context, and runs the conversation.

It ends the conversation by calling one tool, `submit_diagnosis`, with
`is_bug`:

- **`true`** → genuine defect in SmartCore's code. Ticket goes to
  `queued_for_fix` and the pipeline fires.
- **`false`** → feature request, how-to question, billing matter, or a
  user-side problem. Answered in chat and closed. **A feature request never
  reaches the fix agent.**

If a customer asks directly whether they're talking to a bot, the agent is
instructed to say support is AI-assisted with human review, rather than deny it.

### `support-pipeline` (verify_jwt: false, service-key gated)
Not reachable from a browser — the handler rejects anything whose bearer token
isn't the service role key.

1. **Fix agent** — `list_files` / `read_file` over the repo, then `propose_fix`
   with a set of **exact string replacements** (not whole files, so a
   2,000-line page can be edited without truncation risk). It can also call
   `cannot_fix`, which escalates to a human.
2. **Apply + back up** — every original file is stored verbatim in
   `support_fix_attempts.backups` *before* anything changes.
3. **Branch + commit** — `support/sc-XXXX-YYYYYY`, never a direct write to main.
4. **Reviewer agent** — sees the customer report and the exact changed lines,
   and must pass all six checks to approve.
5. **Merge** — only on approval. Rejection escalates to a human instead.

### `support-admin` (verify_jwt: true, staff-gated)
Backs `/hq/support`. Verifies an active row in `smartcore_staff`, then allows
`revert`, `rerun`, `reply`, `close`, `reopen`.

## Safety layers

Four independent things must all agree before a line of live code changes:

1. **Triage gate** — the chat agent must classify it as a bug, not a feature.
2. **Hard guardrails in code** (not model judgement):
   - `FORBIDDEN` paths: `supabase/`, `.github/`, `.env*`, `node_modules/`
   - max 3 files per fix
   - an edit whose `old_string` isn't found, or is found more than once, is
     **rejected rather than guessed**
   - a change that would delete >40% of a file's lines is rejected
   - a change that produces no difference is rejected
3. **Reviewer agent** — all six checks must be `true` *and* the verdict must be
   `approved`. Any uncertainty is an instructed rejection.
4. **Reversibility** — pre-change backups, a branch, and normal git history.

## Reverting

`/hq/support` → open the ticket → **Revert fix**. This restores the exact file
contents captured before the change and merges that to main. `git revert` on the
merge commit also works.

## Tables

| Table | Purpose |
|---|---|
| `support_agents` | The named roster customers see |
| `support_tickets` | One per reported issue |
| `support_messages` | Transcript. `role`: `user` / `agent` / `system` / `internal` |
| `support_fix_attempts` | Proposal, backups, branch, reviewer verdict |
| `support_events` | Audit trail |

**Note:** `support_tickets.user_id` is deliberately *not* a foreign key to
`auth.users` — nothing in this system may ever cascade-delete an auth user.

## Ticket statuses

`triage` → `queued_for_fix` → `fixing` → `in_review` → `fix_deployed`

Off-ramps: `resolved` (answered in chat or confirmed fixed), `escalated` (fix
agent declined, reviewer rejected, or the pipeline errored — needs a human),
`awaiting_user` (a human replied and is waiting on the customer).
