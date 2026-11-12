# Agent notes

## Theme toggle

The light/dark toggle (`src/components/theme-setting.ts`) follows
[Lea Verou's dark mode toggle advice](https://lea.verou.me/blog/2026/dark-mode-toggles/).
Agents have repeatedly broken it by adding a "System" step, so:

- It has exactly two visible states, Light and Dark. Never add "System",
  "Auto", or any other reset entry to the rotation.
- A press flips to the opposite of what is shown.
- If that flip lands on the OS scheme, clear the stored override. Otherwise
  store `light` or `dark`. Following the OS is simply having nothing stored.
- OS colour scheme changes never touch storage. Only a press does.
- Don't model the theme on the backdrop toy setting, which does have a Random
  entry.

Before changing the toggle, read the post and keep
`src/components/theme-setting.test.ts` passing.
