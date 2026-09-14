# Postiz List Draft Management Design

**Date:** 2026-09-14

## Problem

Postiz's List view is not usable as a draft review queue. A draft disappears from the List API as soon as its placeholder `publishDate` is in the past, the List response omits media, Preview is available only through an unlabeled hover icon, and the List toolbar removes the calendar controls. The result is that a user cannot reliably find a newly generated video draft, identify it as video, preview it, or choose when it should be scheduled from the List workflow.

## Goals

- Show every current draft in List view regardless of its placeholder date.
- Put newly created or updated drafts first.
- Make the first attached image or video recognizable without opening the editor.
- Provide persistent Preview and Edit actions on every List item.
- Let the user choose a future date and time for a draft and explicitly schedule it from the List item.
- Preserve existing state filters, customer filter, pagination, full editor, Calendar views, comments, and provider validation.
- Never publish or schedule a draft merely because the user opened List view or changed the picker value.

## Non-goals

- Bulk scheduling multiple drafts in one action.
- Playing every video automatically in the list.
- Replacing the full post editor.
- Changing the batch generator or Facebook content contracts.
- Rescheduling published posts from the new inline control.

## List Query Behavior

The List endpoint keeps its existing state filter and pagination contract, with state-specific visibility and ordering:

| Filter    | Included records                                                | Order                 |
| --------- | --------------------------------------------------------------- | --------------------- |
| All       | All non-deleted root posts in supported List states             | Most recently updated |
| Scheduled | Future `QUEUE` root posts                                       | Earliest publish date |
| Draft     | All `DRAFT` root posts, including placeholder dates in the past | Most recently updated |
| Published | All `PUBLISHED` root posts                                      | Latest publish date   |

The response also includes the root post's media array. Child comment posts remain excluded from the top-level list and continue to load with their parent group when the editor, preview, or scheduler needs them.

## List Item Layout

Each List item becomes a compact management row with four regions:

1. Channel identity and state.
2. A first-media thumbnail next to a two-line content excerpt. Images render as images. Videos render a paused first frame with a play badge and do not autoplay.
3. The current date/time and persistent **Preview** and **Edit** buttons. Preview opens the existing Postiz share preview in a new tab; Edit opens the existing full-screen editor.
4. For `DRAFT` only, a **Choose publish date** control. It opens a date/time popover and shows an explicit **Schedule** button after a valid future date is selected.

Clicking the row continues to open Edit, while clicks inside Preview, media, date, and scheduling controls stop propagation so they do not open two surfaces.

The controls have visible labels, keyboard-focus styles, button semantics, and accessible names. The layout stacks on narrow screens without hiding its actions behind hover.

## Preview Behavior

The thumbnail provides recognition, while the existing `/p/<post-id>?share=true` page remains the full preview renderer. Clicking a video thumbnail or **Preview** opens that page. This avoids creating up to 100 active video players in List view and keeps provider-specific rendering in one place.

If a media URL is unavailable, the row shows a neutral media placeholder and Preview still remains available. A malformed media entry must not prevent the rest of the list from rendering.

## Inline Scheduling Flow

Inline scheduling applies only to a root post whose current state is `DRAFT`:

1. The user opens **Choose publish date** and selects a future local date and time.
2. No request is sent while the picker changes.
3. The user presses **Schedule**. This is the explicit confirmation.
4. The frontend sends the post id and UTC timestamp to a dedicated schedule action.
5. The backend verifies organization ownership, confirms the root is still a draft, validates a future timestamp, loads the whole post group, and performs the same provider/content validation used by the normal editor.
6. The backend changes the root and its child comment records to the scheduled state and starts the normal workflow for the root post.
7. The List cache and Calendar cache refresh. The item leaves the Draft filter and appears under Scheduled.

The dedicated action prevents an ordinary date edit from accidentally changing draft state. A double submission is rejected or resolves idempotently based on the current state; it must not create a duplicate post or duplicate workflow.

## Error Handling

- Past or invalid dates keep **Schedule** disabled and show a local validation message.
- A post that was edited, deleted, or scheduled elsewhere returns a conflict response; the UI shows a toast and refreshes the list.
- Provider or content validation errors are shown without changing the draft.
- Network failures leave the draft unchanged and keep the selected date so the user can retry.
- Preview failures do not mutate the draft.

## Components and Data Flow

- The posts repository owns state-specific List query filters, ordering, and media selection.
- The existing List endpoint continues to minify and return paginated data.
- `ListView` renders a dedicated List item presentation instead of relying on the compact Calendar cell presentation.
- A small media utility classifies the first media path and supplies the thumbnail/play treatment.
- A draft scheduling control owns local picker state and calls the dedicated backend action only after confirmation.
- The posts service owns authorization, validation, group state transition, and workflow start.

Calendar grid drag/drop behavior and the full `AddEditModal` remain unchanged.

## Verification

- Repository tests cover all four state filters, especially an old `DRAFT` remaining visible and newly updated drafts sorting first.
- API tests verify media is present, comments are excluded as top-level rows, pagination totals remain correct, and unauthorized access fails.
- Scheduling tests verify future-date validation, provider validation, group state transition, comment preservation, workflow start, conflict handling, and idempotency.
- Frontend tests cover image, video, and missing-media rows; persistent Preview/Edit actions; stopped row-click propagation; and the draft-only scheduling control.
- Manual browser verification uses the local Facebook Page drafts and confirms a video draft can be found, recognized, previewed, edited, and scheduled from List view.
- The final local deployment rebuilds the Postiz image and verifies both List and existing Calendar views at desktop and narrow widths.

## Success Criteria

- A batch-created video draft remains visible in the Draft list after its placeholder time passes.
- The row visibly identifies the draft as video and opens a working full preview with one click.
- The user can select a future date/time and schedule the draft from List view with an explicit action.
- No action occurs from merely viewing the list, opening Preview, or changing the date picker.
- Image drafts, filters, pagination, comments, and Calendar views continue to work.
