# Todo List

### Extras
- [x] Add line wrap for debug panel

### Span Grouping Refactor
Target: `div.public-DraftEditor-content > div[data-contents="true"]`

**Element types to handle:**
- [x] `<ol>` - numbered list, iterate each `<li>` child, group all span text together
- [x] `<ul>` - regular list
- [x] `<div class='longform-unstyled'>` - text content, find inner spans
- [x] `<section> > <div role='separator'>` - skip these separators
- [x] `<div dir='ltr'>` - headings, find inner spans
- [x] `<blockquote>` - find inner spans

**Logging:**
- [x] Add logging for unknown/unhandled element types encountered during iteration
