# ToolExecutor Routing Design

This document defines how `ToolExecutor` should evolve from manual review into real calendar, task, and document integrations.

## Current State

The current `ToolExecutor` interface lives in `assistant/src/core/contracts.ts` and receives:

- the normalized Gmail message
- the extracted `MessageAssessment`
- the model-generated `suggestedActions`

It returns `PreparedAction[]`.

Today, `ManualReviewToolExecutor` marks every action as:

- `executionMode: "manual_review"`
- `toolName: null`

This keeps the assistant safe while the routing policy is still being defined.

## Design Goals

- Keep tool execution deterministic and auditable.
- Separate LLM extraction from real side effects.
- Allow different action kinds to map to different integrations.
- Make it easy to require confirmation for risky actions.
- Preserve enough metadata to re-run or review decisions later.

## Routing Model

The LLM should suggest actions in generic terms, for example:

- `kind: "calendar_create"`
- `kind: "calendar_update"`
- `kind: "task_create"`
- `kind: "task_update"`
- `kind: "reply_draft"`
- `kind: "document_review"`
- `kind: "follow_up"`

`ToolExecutor` should treat `kind` as an intent, not as a direct instruction to call an API.

The executor should:

1. Validate the suggested action shape.
2. Normalize the action into an internal routing category.
3. Apply policy rules.
4. Choose a concrete tool adapter.
5. Return a `PreparedAction` describing what should happen.

## Suggested Routing Rules

- `calendar_create` or `calendar_update`: route to a calendar adapter if the action has a usable date or time signal.
- `task_create` or `task_update`: route to a task adapter when the item is actionable but does not belong on a calendar.
- `reply_draft`: route to a mail/drafting adapter, but default to manual review.
- `document_review`: route to a document store or retrieval workflow, not a direct side-effect tool.
- `follow_up`: route to a task adapter unless a clearer tool is implied by metadata.
- unknown or low-confidence kinds: keep as `manual_review`.

## Policy Layer

The executor should not rely only on the action `kind`. It should also apply explicit policy checks:

- If `assessment.confidence` is below a threshold, force manual review.
- If `assessment.importance` is `critical`, require manual confirmation before execution.
- If an action would modify existing data, prefer review unless the adapter can guarantee idempotency.
- If required fields are missing, do not route automatically.

This policy should remain in application code, not hidden in prompts.

## Recommended Adapter Shape

Concrete integrations should stay in `assistant/src/adapters/`.

Examples:

- `googleCalendarToolExecutor.ts`
- `todoistToolExecutor.ts`
- `notionTaskToolExecutor.ts`

Each adapter should expose a narrow, testable method that accepts normalized action input, not raw LLM output.

The `ToolExecutor` can be implemented as:

- a single router that delegates to multiple adapters, or
- a composite executor that tries specific handlers in order

The key requirement is that routing decisions are explicit and inspectable.

## PreparedAction Contract

`PreparedAction` should remain the handoff record between extraction and execution.

It should continue to include:

- original suggested action fields
- `executionMode`
- `toolName`
- `reason`

If execution becomes automatic later, consider extending it with:

- `toolPayload`
- `requiresConfirmation`
- `idempotencyKey`
- `executionStatus`

## Recommended Next Step

Implement a `RoutingToolExecutor` that:

1. maps action `kind` values to route handlers
2. applies confidence and importance policy checks
3. returns `manual_review` when no safe adapter matches

That gives you a clean path to add real calendar and task tools without changing the extraction contract or the poll runner.
