# Moved to kopai-skills

Kopai's agent skills are maintained in
[kopai-app/kopai-skills](https://github.com/kopai-app/kopai-skills). The
copies here are frozen: they are kept only so that `npx skills update` can
tell existing installs where the skills went, and they will be removed in a
later release. Don't edit them; open changes on kopai-skills instead.

Switch an existing install to the maintained version:

```bash
npx skills add kopai-app/kopai-skills/plugins/kopai/skills
```

That installs `root-cause-analysis`, `create-dashboard` and
`otel-instrumentation`. `create-live-page` needs Claude, so it isn't in that
set; install it with
`npx skills add kopai-app/kopai-skills --skill create-live-page`.

The Tessl packages (`tessl install kopai/<skill>`) are unchanged and are now
published from kopai-skills.
