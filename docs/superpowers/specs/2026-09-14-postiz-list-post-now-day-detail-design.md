# Postiz List Post Now and Detailed Day View Design

## Problem

Postiz List view now exposes draft media, Preview, Edit, and Schedule, but a user still has to open the full editor to publish a draft immediately. Day mode also renders posts as compact calendar cells organized around time slots, which makes captions and video identity difficult to review.

## Goals

- Add an explicit **Post now** action to draft rows in List view.
- Require an in-app confirmation before publishing immediately.
- Preserve the complete post group: root content, media, settings, tags, and first-comment YouTube link.
- Render Day mode as a detailed list of posts for the selected date using the same row component as List view.
- Keep Week and Month views unchanged.
- Refresh List and Calendar data after any successful action.
- Never create duplicate post records when publishing or scheduling an existing draft.

## List Draft Actions

Every `DRAFT` row shows two state-changing actions:

1. The existing local date/time input and **Schedule** button.
2. A **Post now** button.

Preview and Edit remain visible for every state. Scheduled and published rows do not show Schedule or Post now.

Pressing **Post now** opens an in-app confirmation that names the Page and explains that the draft and its first comment will be published immediately. Cancelling closes the confirmation without a request. Confirming disables the row actions while the request is active.

## Data Flow

Schedule and Post now share one draft-action payload builder:

1. Load the current group from `GET /posts/group/:group`.
2. Verify that the current root exists and remains `DRAFT`.
3. Copy the existing integration, group, settings, tags, root, child comments, ids, content, media, and delays.
4. Submit the existing ids through `POST /posts` with either `type: "schedule"` and the selected future UTC timestamp or `type: "now"` and the current timestamp.
5. Let the existing Postiz service perform provider/content validation and start the publishing workflow.
6. Refresh both List and Calendar caches after success.

Using the existing ids makes the repository update the draft group rather than create a second root or comment. A stale row fails the current-state check and refreshes instead of publishing a non-draft.

## Detailed Day View

Day mode stops building empty integration/time-slot rows. It filters the Calendar response to posts whose local `publishDate` falls on the selected local date, sorts them by publish time, and renders the same detailed row used by List view.

Each row shows:

- the first image or a paused video thumbnail with play badge;
- Page and platform identity;
- state and local publish time;
- a readable two-line caption excerpt;
- persistent Preview and Edit actions;
- Schedule and Post now when the item is a draft.

An empty selected day shows a clear “No posts on this day” message. The Calendar header continues to provide date navigation and Day, Week, Month selection. Week and Month keep their existing grid behavior.

## Components

- `list-view-item.tsx` remains the shared detailed post row and gains a Post now callback, pending-action coordination, and the confirmation modal.
- `list-view.utils.ts` generalizes the draft payload helper so Schedule and Post now use the same preservation rules.
- `calendar.tsx` owns the authenticated requests, shared success/error handling, and data refresh. List and Day both call the same action callbacks.

## Error Handling

- Invalid or past schedule times keep Schedule disabled.
- A Post now cancellation makes no request.
- Network, provider, and validation failures show a warning, keep the row available, and refresh server state.
- A root that is no longer `DRAFT` is rejected before mutation.
- Only one Schedule or Post now request can run for a row at a time.
- Preview and Edit remain read-only with respect to publishing state.

## Verification

- Unit tests cover schedule and now payloads, preservation of root/comment ids and media, and rejection of non-drafts.
- Frontend and backend production builds must pass.
- Existing book Facebook batch tests must remain green.
- Browser verification confirms List exposes Post now and Day displays detailed image/video rows for only its selected date.
- Changing a schedule date without pressing Schedule leaves the database unchanged.
- Post now is not triggered on a real Facebook draft during automated browser verification.
- An isolated far-future or intercepted local fixture verifies request construction and id preservation, then is removed with any workflow terminated before completion.

## Success Criteria

The user can review a draft in List, publish it immediately after an explicit confirmation, or schedule it for later without opening the editor. Selecting Day mode presents readable post rows for that date with the same media and actions, while Week and Month remain useful calendar overviews.
