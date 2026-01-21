# Todo List

### Extras
- [ ] Add line wrap for debug panel

### Span Grouping Refactor
Target: `div.public-DraftEditor-content > div[data-contents="true"]`

**Element types to handle:**
- [ ] `<ol>` - numbered list, iterate each `<li>` child, group all span text together
- [ ] `<ul>` - regular list
- [ ] `<div class='longform-unstyled'>` - text content, find inner spans
- [ ] `<section> > <div role='separator'>` - skip these separators
- [ ] `<div dir='ltr'>` - headings, find inner spans
- [ ] `<blockquote>` - find inner spans

**Logging:**
- [ ] Add logging for unknown/unhandled element types encountered during iteration
