---
"@kopai/ui": patch
---

Fix service chips on the traces page rendering as solid blocks with unreadable
labels in Safari (KOP-29).

The chip tint was built by appending a hex alpha suffix to the `hsl()` string
from `getServiceColor()`, which is not a valid CSS colour. Chromium drops the
declaration, leaving no tint at all; WebKit accepts it on the property-assignment
path React uses and resolves it to the opaque colour, painting each chip over its
own same-coloured label.

`colors.ts` now owns the palette and exposes `getServiceTint(name, alpha)` and
`getServiceLabelColor(name)`, so fill and label are derived separately. The label
lightness also lifts it above the WCAG AA contrast threshold on the dark
background, which the previous 50% did not meet for many hues.
