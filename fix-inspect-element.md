# Fix: Narrator UI Disappears on Window Resize

## Problem

When the browser window is resized to be too narrow, the Narrator UI sidebar disappears because there's no room for it to display. However, the content is still loaded and audio continues playing - the user just loses all control (pause, stop, etc.).

## Root Cause

The Narrator UI is injected into a cloned sidebar container (`aside` element) that is positioned alongside the main article content. Twitter's layout uses flexbox/grid that hides sidebars when viewport becomes too narrow, similar to how the "Relevant people" aside disappears on smaller screens.

## Proposed Solution

### Option 1: Floating/Fixed Overlay (Recommended)

Create a floating, draggable panel that:
- Is positioned fixed/absolute relative to the viewport, not the document flow
- Can be dragged anywhere on screen
- Has a minimize/maximize toggle
- Persists position across page navigations (localStorage)

**Pros:**
- Always visible regardless of viewport size
- User can position it anywhere convenient
- Survives layout changes

**Cons:**
- More complex implementation
- May obscure content (mitigated by draggability)

### Option 2: Floating Toggle Button + Modal

- Show a small floating button when the main UI is hidden
- Clicking opens the full controls in a modal/overlay
- Modal can be dismissed but keeps button visible

**Pros:**
- Cleaner when not in use
- Always accessible via the button

**Cons:**
- Two-step interaction to access controls
- Button still needs to survive viewport changes

### Option 3: Responsive Sidebar Detection

- Detect when the sidebar is hidden (using `ResizeObserver` or `IntersectionObserver`)
- When hidden, automatically switch to floating mode
- Show a "restore" button to re-dock to sidebar when space is available

**Pros:**
- Seamless UX - uses sidebar when available, falls back to floating
- No user configuration needed

**Cons:**
- Most complex implementation
- Potential for layout thrashing

## Recommended Implementation: Option 1

### Technical Approach

1. **Create a new floating container** with these properties:
   ```css
   position: fixed;
   z-index: 10000;
   box-shadow: 0 4px 20px rgba(0,0,0,0.3);
   border-radius: 8px;
   ```

2. **Add drag handle** at the top of the panel for repositioning

3. **Add minimize button** to collapse to just the header

4. **Store position** in localStorage:
   ```javascript
   localStorage.setItem('narratorPosition', JSON.stringify({x, y, minimized}));
   ```

5. **On load:** check if sidebar is available; if yes, dock there; if no, use saved/stored floating position

### UI Changes

```
┌────────────────────────────────────┐
│ ══ Article Narrator        ─ □ ✕ │ ← drag handle, minimize, close
├────────────────────────────────────┤
│ [Settings...]                       │
│ [Extract Text]                      │
│ [Copy Text] [Open in Tab]           │
│ ─────────────────────────────────── │
│ Ready                               │
│ ─────────────────────────────────── │
│ [Play All] [Pause] [Stop]           │
└────────────────────────────────────┘
```

### Success Criteria

- [ ] UI remains visible when window is resized to any width
- [ ] User can drag the panel to any position
- [ ] Panel position persists across page navigations
- [ ] Audio playback controls work regardless of panel state
- [ ] Minimize/collapse functionality works
