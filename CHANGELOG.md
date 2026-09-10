# Changelog

## 0.4.0 — 2026-09-10

- Find saved reviews through the Pi tool's `history` option or CLI `--history`, without calling models.
- Associate new reviews with the calling conversation using `conversationId` or `--conversation-id`. When the ID is missing or has no matches, show recent runs from the current directory.
- Show run IDs, conversation IDs, titles, question previews, and last successful request times. Successful follow-ups refresh that timestamp while preserving the original conversation and question.
- Document when agents should continue a review or start a separate run, including recovery after conversation compaction and warnings against cross-conversation reuse.
