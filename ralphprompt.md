# Dev Tasks

## Checklist 1: Remove Estimate Audio
- [ ] Remove `#estimate` button from `narrator-ui.html`
- [ ] Remove `#estimateInfo` panel from `narrator-ui.html`
- [ ] Remove estimate click handler from `content.js` (`narratorUi.querySelector('#estimate').onclick = ...`)
- [ ] Remove `lastPlayedAudioSize` usage in estimate handler
- [ ] Commit

## Checklist 2: Remove Play First / Play Current
- [ ] Remove `#playFirst` and `#playCurrent` buttons from `narrator-ui.html`
- [ ] Remove click handlers for both buttons from `content.js`
- [ ] Remove disabled state toggling for these buttons in `cleanupPlayback()`, `playSpansSequentially()`, and other places
- [ ] Commit

## Checklist 3: Remove Span Viewing UI
- [ ] Remove `#spanInfo` panel from `narrator-ui.html`
- [ ] Remove `#pagination` div from `narrator-ui.html`
- [ ] Remove `#prevSpan` and `#nextSpan` buttons from `narrator-ui.html`
- [ ] Remove `updateSpanInfo()` function from `content.js`
- [ ] Remove `updatePaginationButtons()` function from `content.js`
- [ ] Remove `loadSpan()` function from `content.js`
- [ ] Remove `showNavigation()` function from `content.js`
- [ ] Remove calls to these functions throughout `content.js`
- [ ] Clean up related state: `currentSpanText`, `currentSpanIndex` used for UI display
- [ ] Commit

## Checklist 4: Auto-Highlight Span During Playback
- [ ] Remove `#jumpToSpan` button from `narrator-ui.html`
- [ ] Remove `#jumpGroup` div from `narrator-ui.html`
- [ ] Keep the jump logic (scrolling to span) but call it automatically in `playSingleSpan()`
- [ ] Add 1-second highlight effect when span starts playing (e.g., flash background)
- [ ] Commit

## Checklist 5: finish
- [ ] just say "DONE"
