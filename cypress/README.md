# Cypress runtime contracts

The test suite covers two different deployments and must not silently mix
them:

- `npm test` and `npm run test:prod` start lean4game's native relay. They run
  the relay-compatible regression spec only. Routes at `/` use the websocket
  Lean server supplied by that stack.
- The mounted routes under `/lean4game/index.html` use the browser-local Lean
  WebAssembly runtime. They require the complete lean4.js release site,
  including `/visual-lean` and mounted game data. The lean4.js Docker release
  workflow runs the full Cypress suite against that assembled image.

`cypress:run` remains available for running the full suite when the configured
`baseUrl` points at an assembled release site. Pass
`--env LEAN4GAME_MOUNT=/lean4game/index.html` for that mode.

The complete NNG4 playthrough uses `CompletePlaythroughDriver` to click,
double-click, and drag rendered player elements. Its test bridge is read-only:
it audits proof state but does not submit tactics. The spec stops after the
first failed level so a broken gesture produces prompt, actionable CI output;
all 66 playable levels are exercised when the run is green.
