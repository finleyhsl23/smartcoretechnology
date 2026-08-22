// =====================================================================
// SmartCore — support-pipeline
//
//   ticket (is_bug) →  FIX AGENT  →  backup + branch + commit
//                   →  REVIEW AGENT (strict, bug-fix-only rubric)
//                   →  approved ? merge to main : escalate to a human
//                   →  post the "your fix is live" message on the ticket
//
// The fix agent submits exact string replacements, not whole files, so a
// large page can be edited safely without truncation risk.
//
// Also supports { action: "revert", attempt_id } to restore the exact
// pre-change file contents captured before the fix agent touched anything.
//
// Internal only: requires the service-role key as a bearer token.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const REPO = Deno.env.get("SUPPORT_REPO") ?? "finleyhsl23/smartcoretechnology";
const BASE_BRANCH = Deno.env.get("SUPPORT_BASE_BRANCH") ?? "main";
const FIX_MODEL = Deno.env.get("SUPPORT_FIX_MODEL") ?? "claude-opus-5";
const REVIEW_MODEL = Deno.env.get("SUPPORT_REVIEW_MODEL") ?? "claude-opus-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// ------------------------------------------------------------ guardrails
// Paths the fix agent may never touch, whatever it decides.
const FORBIDDEN = [
  /^supabase\//i,
  /^\.github\//i,
  /^\.env/i,
  /package-lock\.json$/i,
  /^node_modules\//i,
];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 400_000;
const MAX_SHRINK_RATIO = 0.4; // a fix may not delete >40% of a file

const TEXT_EXT =
  /\.(html?|css|js|mjs|cjs|ts|tsx|jsx|json|md|txt|svg|toml|yml|yaml)$/i;

function forbidden(path: string) {
  return FORBIDDEN.some((re) => re.test(path));
}

// ------------------------------------------------------------ base64
const b64encode = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};
const b64decode = (s: string) => {
  const bin = atob(s.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

// ------------------------------------------------------------ github
async function gh(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "smartcore-support-pipeline",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path}: ${await r.text()}`);
  return await r.json();
}

async function getBaseSha() {
  const ref = await gh(`/repos/${REPO}/git/ref/heads/${BASE_BRANCH}`);
  return ref.object.sha as string;
}

async function listTree() {
  const tree = await gh(
    `/repos/${REPO}/git/trees/${BASE_BRANCH}?recursive=1`,
  );
  return (tree.tree ?? [])
    .filter(
      (n: any) =>
        n.type === "blob" &&
        TEXT_EXT.test(n.path) &&
        !forbidden(n.path) &&
        (n.size ?? 0) < MAX_FILE_BYTES,
    )
    .map((n: any) => ({ path: n.path, size: n.size }));
}

async function readFile(path: string) {
  const f = await gh(
    `/repos/${REPO}/contents/${encodeURI(path)}?ref=${BASE_BRANCH}`,
  );
  return { content: b64decode(f.content), sha: f.sha as string };
}

async function createBranch(name: string, sha: string) {
  await gh(`/repos/${REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
  });
}

async function commitFile(
  branch: string,
  path: string,
  content: string,
  sha: string,
  message: string,
) {
  return await gh(`/repos/${REPO}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: b64encode(content),
      sha,
      branch,
    }),
  });
}

async function mergeBranch(branch: string, message: string) {
  return await gh(`/repos/${REPO}/merges`, {
    method: "POST",
    body: JSON.stringify({ base: BASE_BRANCH, head: branch, commit_message: message }),
  });
}

// ------------------------------------------------------------ anthropic
async function anthropic(body: unknown) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  return await r.json();
}

// ------------------------------------------------------------ fix agent
const FIX_TOOLS = [
  {
    name: "list_files",
    description:
      "List the repository's text files. Optionally filter by a substring of the path.",
    input_schema: {
      type: "object",
      properties: { filter: { type: "string" } },
    },
  },
  {
    name: "read_file",
    description: "Read the full current contents of one file.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "propose_fix",
    description:
      "Submit the finished fix as a set of exact string replacements.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: what was wrong." },
        rationale: {
          type: "string",
          description:
            "Why this change fixes the reported defect, and why it is safe.",
        },
        edits: {
          type: "array",
          description: "The replacements to apply, in order.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              old_string: {
                type: "string",
                description:
                  "Exact text to replace, copied verbatim from the file. Must appear EXACTLY ONCE — include surrounding lines to make it unique.",
              },
              new_string: {
                type: "string",
                description: "Replacement text.",
              },
              reason: { type: "string" },
            },
            required: ["path", "old_string", "new_string", "reason"],
          },
        },
      },
      required: ["summary", "rationale", "edits"],
    },
  },
  {
    name: "cannot_fix",
    description:
      "Use when this is not a fixable code defect, you cannot locate the cause, or a safe minimal fix is not possible.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

function fixSystemPrompt() {
  return `You are a senior engineer at SmartCore Technology fixing a customer-reported defect in the SmartCore web codebase (mostly self-contained HTML pages with inline CSS and JS, backed by Supabase).

ABSOLUTE RULES
1. Fix the reported bug and NOTHING else. No refactors, no tidying, no renaming, no "while I'm here" improvements, no new features.
2. Change the fewest lines possible. Ideally one file; never more than ${MAX_FILES}.
3. You submit EXACT STRING REPLACEMENTS, not whole files. For each edit, old_string must be copied verbatim from the file you read, including its exact indentation and whitespace, and must appear EXACTLY ONCE in that file. If the snippet you want is not unique, widen it with surrounding lines until it is.
4. Never touch: authentication, login, session handling, payments, Supabase RLS policies, API keys, or anything that deletes data or users.
5. Never remove large blocks of code. If the fix seems to need that, call cannot_fix instead.
6. Preserve the existing code style exactly — same indentation, same naming, same idioms.
7. If you cannot confidently locate the defect from the report, call cannot_fix. A wrong guess is far worse than no fix.

METHOD
Use list_files to orient yourself, read_file on the likely files, then propose_fix. Read before you write — never edit a file you have not read in full.`;
}

async function runFixAgent(ticket: any, tree: any[]) {
  const readCache: Record<string, { content: string; sha: string }> = {};

  const report = `CUSTOMER BUG REPORT — ticket ${ticket.ticket_ref}

Module: ${ticket.module_name || ticket.module_slug || "not specified"}
Severity: ${ticket.severity}
Subject: ${ticket.subject}

Support engineer's diagnosis:
${ticket.diagnosis || "(none recorded)"}

Error message reported:
${ticket.error_message || "(none)"}

Browser console output:
${ticket.console_log || "(none)"}

Steps to reproduce:
${ticket.steps_to_repro || "(none)"}

Browser info: ${JSON.stringify(ticket.browser_info ?? {})}`;

  const messages: any[] = [{ role: "user", content: report }];

  for (let turn = 0; turn < 14; turn++) {
    const res = await anthropic({
      model: FIX_MODEL,
      max_tokens: 16000,
      system: fixSystemPrompt(),
      tools: FIX_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: res.content });

    const toolUses = (res.content ?? []).filter(
      (b: any) => b.type === "tool_use",
    );
    if (!toolUses.length) {
      return { ok: false, reason: "Fix agent stopped without proposing anything." };
    }

    const results: any[] = [];

    for (const tu of toolUses) {
      if (tu.name === "propose_fix") {
        return { ok: true, proposal: tu.input, readCache };
      }
      if (tu.name === "cannot_fix") {
        return { ok: false, reason: tu.input.reason };
      }
      if (tu.name === "list_files") {
        const f = (tu.input.filter ?? "").toLowerCase();
        const list = tree
          .filter((n) => !f || n.path.toLowerCase().includes(f))
          .slice(0, 400)
          .map((n) => `${n.path} (${n.size}b)`)
          .join("\n");
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: list || "(no matching files)",
        });
      }
      if (tu.name === "read_file") {
        const p = String(tu.input.path ?? "");
        if (forbidden(p)) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: "That path is off limits.",
            is_error: true,
          });
          continue;
        }
        try {
          if (!readCache[p]) readCache[p] = await readFile(p);
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: readCache[p].content,
          });
        } catch (e) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Could not read ${p}: ${(e as Error).message}`,
            is_error: true,
          });
        }
      }
    }

    messages.push({ role: "user", content: results });
  }

  return { ok: false, reason: "Fix agent exceeded its step budget." };
}

// ------------------------------------------------------------ review agent
const REVIEW_TOOL = {
  name: "submit_review",
  description: "Record your review decision.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["approved", "rejected"] },
      reason: {
        type: "string",
        description: "One short paragraph justifying the verdict.",
      },
      checks: {
        type: "object",
        properties: {
          fixes_reported_bug: { type: "boolean" },
          is_minimal: { type: "boolean" },
          no_unrelated_changes: { type: "boolean" },
          no_new_features: { type: "boolean" },
          touches_nothing_sensitive: { type: "boolean" },
          syntax_looks_valid: { type: "boolean" },
        },
        required: [
          "fixes_reported_bug",
          "is_minimal",
          "no_unrelated_changes",
          "no_new_features",
          "touches_nothing_sensitive",
          "syntax_looks_valid",
        ],
      },
    },
    required: ["verdict", "reason", "checks"],
  },
};

function reviewSystemPrompt() {
  return `You are the release reviewer for SmartCore Technology. You are the ONLY gate between an automated code change and the live production website used by paying customers. Finley, the founder, has delegated his approval to you. Act with his caution.

You are not reviewing whether the code is elegant. You are answering one question: is it SAFE to merge this to main right now?

APPROVE ONLY IF ALL SIX ARE TRUE:
1. fixes_reported_bug — the change plausibly and directly fixes the specific defect in the customer report. Not a related issue. Not a general improvement.
2. is_minimal — the smallest sensible change. A handful of lines, not a rewrite.
3. no_unrelated_changes — every single hunk traces back to the reported bug. Reformatting, reordering, renaming, or "tidying" anywhere in the file is an automatic rejection.
4. no_new_features — it fixes broken behaviour; it does not add capability. A feature request dressed as a bug fix is an automatic rejection.
5. touches_nothing_sensitive — no auth, login, sessions, payments, RLS, API keys, user deletion, or data-destructive logic.
6. syntax_looks_valid — brackets, tags, quotes and braces balance; nothing is truncated; no placeholder comments like "rest of file unchanged".

If any check is false, verdict MUST be "rejected".
If you are uncertain, reject. A rejected ticket costs a customer a short wait. A bad merge breaks the live site for everyone.

You will be shown, for each changed file, the exact lines that differ. Scrutinise every one.`;
}

function lineDiff(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [];
  // simple LCS-free windowed diff — good enough for review of small edits
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++; j++; continue;
    }
    // find next sync point
    let found = false;
    for (let k = 1; k <= 40 && !found; k++) {
      if (j + k < b.length && a[i] === b[j + k]) {
        for (let x = 0; x < k; x++) out.push(`+${j + x + 1}: ${b[j + x]}`);
        j += k; found = true;
      } else if (i + k < a.length && a[i + k] === b[j]) {
        for (let x = 0; x < k; x++) out.push(`-${i + x + 1}: ${a[i + x]}`);
        i += k; found = true;
      }
    }
    if (!found) {
      if (i < a.length) out.push(`-${i + 1}: ${a[i]}`);
      if (j < b.length) out.push(`+${j + 1}: ${b[j]}`);
      i++; j++;
    }
    if (out.length > 600) { out.push("… (diff truncated)"); break; }
  }
  return out.join("\n") || "(no textual difference)";
}

async function runReviewAgent(ticket: any, proposal: any, diffs: string) {
  const res = await anthropic({
    model: REVIEW_MODEL,
    max_tokens: 4000,
    system: reviewSystemPrompt(),
    tools: [REVIEW_TOOL],
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [
      {
        role: "user",
        content: `THE CUSTOMER REPORT (ticket ${ticket.ticket_ref})
Module: ${ticket.module_name || ticket.module_slug || "n/a"}
Subject: ${ticket.subject}
Diagnosis: ${ticket.diagnosis || "(none)"}
Error: ${ticket.error_message || "(none)"}
Console: ${ticket.console_log || "(none)"}
Steps: ${ticket.steps_to_repro || "(none)"}

THE PROPOSED FIX
Summary: ${proposal.summary}
Rationale: ${proposal.rationale}
Files changed: ${[...new Set((proposal.edits ?? []).map((e: any) => e.path))].join(", ")}

THE ACTUAL CHANGES
${diffs}`,
      },
    ],
  });

  for (const b of res.content ?? []) {
    if (b.type === "tool_use" && b.name === "submit_review") return b.input;
  }
  return {
    verdict: "rejected",
    reason: "Reviewer did not return a decision.",
    checks: {},
  };
}

// ------------------------------------------------------------ messaging
async function postAgentMessage(admin: any, ticket: any, content: string) {
  await admin.from("support_messages").insert({
    ticket_id: ticket.id,
    role: "agent",
    author_name: ticket.agent_name,
    content,
  });
}

function fixLiveMessage(ticket: any, summary: string) {
  const name = (ticket.contact_name || "there").split(" ")[0];
  const mod = ticket.module_name || ticket.module_slug || "the module";
  return `Hi ${name}, we've reviewed the issue you reported with ${mod} and pushed a fix.

${summary}

Could you refresh the page and let us know if that resolves it?

If the page looks the same after refreshing, try a hard refresh: **Cmd + Shift + R** on Mac or **Ctrl + Shift + R** on Windows. Or open a private tab to bypass any cached version — Chrome/Edge: Ctrl+Shift+N (Windows) or Cmd+Shift+N (Mac); Safari: Cmd+Shift+N; Firefox: Ctrl+Shift+P or Cmd+Shift+P.

${ticket.agent_name} • ${ticket.agent_title}`;
}

function escalationMessage(ticket: any) {
  const name = (ticket.contact_name || "there").split(" ")[0];
  return `Hi ${name}, thanks for your patience. I've had a proper look at this one and it needs a closer inspection than I can safely do from here, so I've passed it to our development team with everything you've given me.

We'll come back to you on this ticket (${ticket.ticket_ref}) as soon as we've got something. Nothing further needed from you for now.

${ticket.agent_name} • ${ticket.agent_title}`;
}

// ------------------------------------------------------------ revert
async function doRevert(admin: any, attemptId: string) {
  const { data: attempt } = await admin
    .from("support_fix_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return json({ error: "Attempt not found." }, 404);
  if (!attempt.backups) return json({ error: "No backup recorded." }, 400);

  const branch = `revert/${attemptId.slice(0, 8)}`;
  const baseSha = await getBaseSha();
  await createBranch(branch, baseSha);

  for (const [path, original] of Object.entries(attempt.backups as Record<string, string>)) {
    const cur = await gh(`/repos/${REPO}/contents/${encodeURI(path)}?ref=${branch}`);
    await commitFile(
      branch,
      path,
      original,
      cur.sha,
      `Revert automated fix on ${path} (attempt ${attemptId.slice(0, 8)})`,
    );
  }
  const merge = await mergeBranch(branch, `Revert automated fix ${attemptId.slice(0, 8)}`);

  await admin
    .from("support_fix_attempts")
    .update({ status: "reverted", reverted_at: new Date().toISOString() })
    .eq("id", attemptId);

  return json({ ok: true, reverted: true, merge_sha: merge?.sha ?? null });
}

// ------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // internal-only
  const auth = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (auth !== SERVICE_KEY) return json({ error: "Forbidden." }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));

  if (body.action === "revert") {
    try {
      return await doRevert(admin, body.attempt_id);
    } catch (e) {
      return json({ error: String((e as Error).message) }, 500);
    }
  }

  const ticketId = body.ticket_id;
  if (!ticketId) return json({ error: "ticket_id required." }, 400);

  const { data: ticket } = await admin
    .from("support_tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return json({ error: "Ticket not found." }, 404);

  let attemptId: string | null = null;

  try {
    if (!ANTHROPIC_API_KEY || !GITHUB_TOKEN) {
      throw new Error("Pipeline not configured (missing ANTHROPIC_API_KEY or GITHUB_TOKEN).");
    }

    await admin.from("support_tickets").update({ status: "fixing" }).eq("id", ticketId);

    const { count } = await admin
      .from("support_fix_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", ticketId);

    const { data: attempt } = await admin
      .from("support_fix_attempts")
      .insert({
        ticket_id: ticketId,
        attempt_no: (count ?? 0) + 1,
        status: "generating",
      })
      .select("id")
      .single();
    attemptId = attempt.id;

    // ---------- 1. FIX AGENT ----------
    const tree = await listTree();
    const fix: any = await runFixAgent(ticket, tree);

    if (!fix.ok) {
      await admin
        .from("support_fix_attempts")
        .update({ status: "failed", error: fix.reason })
        .eq("id", attemptId);
      await admin
        .from("support_tickets")
        .update({ status: "escalated" })
        .eq("id", ticketId);
      await admin.from("support_events").insert({
        ticket_id: ticketId,
        kind: "fix_agent_declined",
        detail: { reason: fix.reason },
      });
      await postAgentMessage(admin, ticket, escalationMessage(ticket));
      return json({ ok: false, stage: "fix", reason: fix.reason });
    }

    const proposal = fix.proposal;
    const edits = proposal.edits ?? [];
    if (!edits.length) throw new Error("Fix agent proposed no edits.");

    const paths: string[] = [
      ...new Set(edits.map((e: any) => String(e.path))),
    ] as string[];
    if (paths.length > MAX_FILES) {
      throw new Error(`Fix touches ${paths.length} files (max ${MAX_FILES}).`);
    }

    // ---------- 2. APPLY EDITS + GUARDRAILS + BACKUPS ----------
    const backups: Record<string, string> = {};
    const shas: Record<string, string> = {};
    const updated: Record<string, string> = {};
    const reasons: Record<string, string[]> = {};

    for (const p of paths) {
      if (forbidden(p)) throw new Error(`Fix touched a forbidden path: ${p}`);
      const cur = fix.readCache[p] ?? (await readFile(p));
      backups[p] = cur.content;
      shas[p] = cur.sha;
      updated[p] = cur.content;
      reasons[p] = [];
    }

    for (const e of edits) {
      const p = String(e.path);
      const oldStr = String(e.old_string ?? "");
      const newStr = String(e.new_string ?? "");
      if (!oldStr) throw new Error(`Empty old_string in edit on ${p}.`);

      const hits = updated[p].split(oldStr).length - 1;
      if (hits === 0) {
        throw new Error(
          `Edit target not found in ${p}. The agent's old_string did not match the file.`,
        );
      }
      if (hits > 1) {
        throw new Error(
          `Edit target is ambiguous in ${p} (${hits} matches). Refusing to guess.`,
        );
      }
      updated[p] = updated[p].replace(oldStr, newStr);
      reasons[p].push(e.reason);
    }

    const diffParts: string[] = [];
    for (const p of paths) {
      const beforeLines = backups[p].split("\n").length;
      const afterLines = updated[p].split("\n").length;
      if (afterLines < beforeLines * (1 - MAX_SHRINK_RATIO)) {
        throw new Error(
          `Fix would delete too much of ${p} (${beforeLines} → ${afterLines} lines).`,
        );
      }
      if (updated[p] === backups[p]) {
        throw new Error(`Edits produced no change in ${p}.`);
      }
      diffParts.push(
        `===== ${p} =====\nreason: ${reasons[p].join("; ")}\n${lineDiff(backups[p], updated[p])}`,
      );
    }

    await admin
      .from("support_fix_attempts")
      .update({
        status: "awaiting_review",
        summary: proposal.summary,
        rationale: proposal.rationale,
        files_changed: paths.map((p) => ({ path: p, reason: reasons[p].join("; ") })),
        backups,
        patch: edits,
      })
      .eq("id", attemptId);

    // ---------- 3. BRANCH + COMMIT ----------
    const branch = `support/${ticket.ticket_ref.toLowerCase()}-${attemptId!.slice(0, 6)}`;
    const baseSha = await getBaseSha();
    await createBranch(branch, baseSha);

    let lastCommit = "";
    for (const p of paths) {
      const res = await commitFile(
        branch,
        p,
        updated[p],
        shas[p],
        `fix(${ticket.ticket_ref}): ${proposal.summary}`.slice(0, 200),
      );
      lastCommit = res?.commit?.sha ?? lastCommit;
    }

    await admin
      .from("support_fix_attempts")
      .update({ branch_name: branch, base_sha: baseSha, commit_sha: lastCommit })
      .eq("id", attemptId);
    await admin
      .from("support_tickets")
      .update({ status: "in_review" })
      .eq("id", ticketId);

    // ---------- 4. REVIEW AGENT ----------
    const review = await runReviewAgent(ticket, proposal, diffParts.join("\n\n"));
    const allChecksPass =
      review.checks &&
      Object.keys(review.checks).length >= 6 &&
      Object.values(review.checks).every((v) => v === true);
    const approved = review.verdict === "approved" && allChecksPass;

    await admin
      .from("support_fix_attempts")
      .update({
        reviewer_verdict: approved ? "approved" : "rejected",
        reviewer_reason: review.reason,
        reviewer_checks: review.checks,
        reviewed_at: new Date().toISOString(),
        status: approved ? "approved" : "rejected",
      })
      .eq("id", attemptId);

    await admin.from("support_events").insert({
      ticket_id: ticketId,
      kind: approved ? "review_approved" : "review_rejected",
      detail: review,
    });

    // ---------- 5. DEPLOY OR ESCALATE ----------
    if (!approved) {
      await admin
        .from("support_tickets")
        .update({ status: "escalated" })
        .eq("id", ticketId);
      await postAgentMessage(admin, ticket, escalationMessage(ticket));
      return json({ ok: false, stage: "review", review });
    }

    const merge = await mergeBranch(
      branch,
      `fix(${ticket.ticket_ref}): ${proposal.summary}\n\nReviewed and approved by SmartCore release review.`,
    );

    await admin
      .from("support_fix_attempts")
      .update({
        status: "deployed",
        merge_sha: merge?.sha ?? null,
        deployed_at: new Date().toISOString(),
      })
      .eq("id", attemptId);

    await admin
      .from("support_tickets")
      .update({ status: "fix_deployed" })
      .eq("id", ticketId);

    await postAgentMessage(admin, ticket, fixLiveMessage(ticket, proposal.summary));

    await admin.from("support_events").insert({
      ticket_id: ticketId,
      kind: "deployed",
      detail: { branch, merge_sha: merge?.sha, summary: proposal.summary },
    });

    return json({ ok: true, deployed: true, branch, merge_sha: merge?.sha });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("support-pipeline", msg);
    if (attemptId) {
      await admin
        .from("support_fix_attempts")
        .update({ status: "failed", error: msg })
        .eq("id", attemptId);
    }
    await admin
      .from("support_tickets")
      .update({ status: "escalated" })
      .eq("id", ticketId);
    await admin.from("support_events").insert({
      ticket_id: ticketId,
      kind: "pipeline_error",
      detail: { error: msg },
    });
    try {
      await postAgentMessage(admin, ticket, escalationMessage(ticket));
    } catch { /* ignore */ }
    return json({ ok: false, error: msg }, 500);
  }
});
