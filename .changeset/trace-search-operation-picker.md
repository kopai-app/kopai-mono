---
"@kopai/ui": patch
---

Fixed the trace search operation picker staying empty until a search had already been run. Operations now load from the service selected in the form rather than the one in the URL, which only catches up on submit. Changing the service also clears any operation held over from the previous one, the picker is disabled until a service is chosen, and selecting "All Services" now actually clears the service filter instead of re-applying the current one.
