---
name: rejudge
description: Run Rejudge — send a question to separate reviewers and a judge, returning one reviewed result (the rejudge tool inside Pi, else the rejudge CLI; read-only). Use when the user says /rejudge or wants a multi-model review. For one external reviewer, use ask-subagent instead.
user_invocable: true
---

# Rejudge

One invocation = one review result: separate reviewers investigate the question and a judge returns one answer. Want two runs? Invoke the skill twice. For one external opinion from one model, use `ask-subagent` instead.

## Pick the path by where you're running — THIS FIRST

- **Inside Pi** — if the `rejudge` tool is available, **use that tool** for history, new reviews, and follow-ups. Do not run the CLI: it would repeat the whole panel in a separate process. Apply "Find or continue a review" below before calling it.
- **Anywhere else** (Claude Code or any harness without the `rejudge` tool) — run the CLI as described below.

If `rejudge` appears in the available tools, use it. Fall back to the CLI only when the tool genuinely is not exposed.

## Find or continue a review

Pass your calling conversation's ID whenever available: `conversationId` in the tool or `--conversation-id <id>` in the CLI. This is the host conversation ID, not a Rejudge run ID. In Pi shell tools it is available as `PI_SESSION_ID`; in other hosts use their supplied session ID. Do not invent an ID when the host does not expose one. Missing IDs are accepted.

If you already know the run ID of the relevant review in this conversation, continue directly with `resumeRunId` or `--resume <id>`. No history lookup is needed.

Before creating a new run, check history, including when conversation compaction may have removed a previous run ID:

- Tool: `{ "history": true, "conversationId": "<host-conversation-id>" }`, without a question or other review inputs.
- CLI: `rejudge --history --conversation-id <host-conversation-id>`.
- If the conversation ID is unavailable, omit that argument. If it is absent or has no matches, the result explains why and shows up to five recent runs from the current directory, not sibling worktrees.

Choose by meaning, without asking the user to select a run: follow-up changes to code under review continue that review; independent questions, including separate research, start a new run. A failed resume is not permission to silently start from scratch.

**Strongly discouraged: continuing a run from another conversation.** It can mix an independent request with unrelated context. Inspect the returned conversation IDs, dates, titles, and question previews; the fallback list helps discover work, not automatically reuse the latest run. Missing ownership does not mean a run belongs to this conversation.

History lookup makes no model calls and needs no model configuration. Results show at most five runs ordered by the last successful request, with the total match count. Questions longer than 2000 characters are marked as truncated; their full text stays in the saved run manifest.

## The CLI

MUST NOT run the `rejudge` CLI inside a sandbox because the sandbox can hide the user’s saved provider login.

In Codex, MUST run the Rejudge CLI with `exec_command` in a TTY and keep the same session attached through `write_stdin` until it returns an `exit_code`; MUST NOT use `functions.exec` or `functions.wait`, and MUST NOT inspect the result file before the process exits.

`rejudge` is the installed command and runs from any project. The current directory controls config lookup and reviewer file access. When developing Rejudge from a source checkout, run `just build-cli` from that checkout's root after a fresh checkout, a pull, or any `src/` change.

## Prerequisites

- **Config**: Rejudge reads `<cwd>/.rejudge/config.json`, else `~/.config/rejudge/config.json` (or `$XDG_CONFIG_HOME/rejudge/config.json`). It contains `reviewers` and `judge` model IDs. A project config shadows the global config, so check the `config: <path>` line before trusting the result. With `debugLog: true`, logs go under `.rejudge/logs/`. On a non-zero exit, report the stderr reason; do not guess models.
- **Key**: `OPENCODE_API_KEY` exported in the environment, or Pi's stored auth (`pi login`). Never baked in. A missing key isn't instant — all agents fail a minute or two in, so confirm auth before a long run.

## Read-only by default

Rejudge is an ask: reviewers run read-only with `read`/`grep`/`find`/`ls`, and the judge gets only `ask_panel`. A review cannot modify files or run shell commands in the reviewed cwd. Do not pass `--unsafe`/`--full`; they enable write/bash for reviewers.

## Launch — foreground, blocking (never tmux/background) — CLI path only

(Skip this whole section when inside Pi — call the `rejudge` tool instead.)

Run it in the foreground and wait. No tmux, detached sessions, polling, or background jobs. Progress streams to stderr; the review result goes to stdout.

### Step 1 — feed the prompt on stdin via a quoted heredoc

The CLI reads the prompt from stdin — no temp file. Use a **quoted** heredoc (`<<'EOF'`) so nothing is escaped or interpolated. Never pass the prompt via `$(...)`, an unquoted heredoc, or an inline argument. Run it from the project root you want reviewed (the cwd drives BOTH config lookup and the panel agents' tools):

    # read-only by default — do NOT add --unsafe or --full (those enable write/bash)
    rejudge --conversation-id <host-conversation-id> > /tmp/rejudge-<id>.md <<'EOF'
    ... full prompt body, multi-line, no escaping ...
    EOF
    echo "exit=$?"

For a follow-up, add `--resume <run-id>` to the command. Omit `--conversation-id` only when the host ID is unavailable; resume retains the run's original conversation ID.

- stdin (the heredoc) = the prompt; `> /tmp/rejudge-<id>.md` captures the result.
- stdout (`/tmp/rejudge-<id>.md`) = the review result.
- stderr = progress and any error.
- Exit status: `0` = success; any non-zero = failure, with the reason on stderr.

(A prompt already sitting in a file still works with `-f <file>`; stdin is the no-temp-file path.)

A real run is minutes (the panel runs at xhigh), so set a generous timeout on the bash command itself (the timeout is per-invocation). If a run is killed for time, report it and re-run; never background it.

## The prompt is the task, not Rejudge orchestration

Rejudge already starts the reviewers and judge. The prompt is delivered to a reviewer as its task; it must say only what that reviewer should investigate or return. Do not ask it to start, call, ask, verify, or coordinate Rejudge, a panel, reviewers, a judge, agents, or another review. Those are runtime mechanics, not task requirements, and can make a reviewer attempt a nested review.

Use a concrete review task when reviewing work:

```text
Identify the two most important risks in the current diff. For each, state the evidence and consequence.
```

Never write prompts such as:

```text
Ask the panel to verify that reviewers and judge can complete normally.
Ask reviewers to run Rejudge and have the judge collect their results.
Verify the panel, reviewers, or judge.
```

## Prompt content

Give the agents what to reason about:
- the user's goal
- relevant paths / context (for a code review: point at `git diff` and the specific files)
- the exact question to answer

## Output to the user (strict)

The full review answer is the run's result — the `rejudge` tool result inside Pi, or `/tmp/rejudge-<id>.md` from the CLI. Do not paste it verbatim unless asked. Translate reviewer wording into plain language and first give enough context to understand what was reviewed. If Rejudge answered your own prompt, state what you asked and what inputs you provided.

Use this structure:

    ### Context
    <1-3 concise bullets: the exact question you asked Rejudge, the important files/diff/data you provided, and any key assumption>

    ### Rejudge result
    (CLI only) Full answer in: /tmp/rejudge-<id>.md
    <3-7 concise bullets in plain user-facing language, no raw reviewer jargon, no long quotes/diffs/logs>

    ### Summary
    <your own 1-3 sentence interpretation and what it changes>

    ### Next action
    <one line, or "none — waiting for user direction">

## Failure modes

A non-zero exit always prints why on stderr — read the message, don't decode the number:
- **config missing/invalid**: tell the user; don't invent models.
- **didn't complete** (a model/tool failed): report the stderr tail; don't retry without confirmation.
- **bin missing**: build it (`just build-cli` in the repo), then retry.
- **killed for time**: report and re-run; consider a lighter panel for that repo. Never background.
