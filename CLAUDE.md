# Room Card: notes for working on this repo

Marketplace (formerly HACS) dashboard card for the whole house, drawn as a cut-away of the owner's house. Sister repos with the same conventions: [gardenview-house](https://github.com/BarBaar44/gardenview-house) (the garden facade drawn on the right comes from it), [tesla-model3-card](https://github.com/BarBaar44/tesla-model3-card) (the drawing style), [irrigation-card](https://github.com/BarBaar44/irrigation-card) (text column and details dialog), [streetview-house](https://github.com/BarBaar44/streetview-house).

## Files

| File | Purpose |
|---|---|
| `room-card.js` | The whole card: plain custom element, no build step, no dependencies, one block scope. `RC_DEFAULTS` holds neutral names and no entities, `rcScene(v)` the drawing (an SVG template filled from `_sceneValues`), `RoomCard` the card, `RoomCardEditor` the visual editor. |
| `tests/room-card.test.js` | jsdom tests: header, drawing values, day/night, taps, rollback, failures, All off, details, config errors, editor round trips. `npm test`. |
| `rooms.yaml` | Example config with made-up entity ids. |
| `shot.png` | README image (night in dark theme, day in light theme) with generic names, linked by absolute raw URL. |

## Rules to keep

* The rooms are fixed places in the drawing (the owner's house, confirmed in the mockup rounds of 16 Nov 2026), keyed by place: `attic_left` (bed under the dakkapel, bed light) and `attic_right` (bike); first floor `first_1` (bed, bed light), `first_2` (desk), `first_3` (king bed, ceiling fan), `first_4` (bathroom: shower cabin only, ceiling extractor, light, fan and shower roles); ground floor `ground_left` (hallway, stairs) and `ground_right` (living room, radiator, open passage to the kitchen, no door). The first floor windows on the garden side: the front one follows `first_3`'s light, the back one (frosted) `first_4`'s. The bed lights are small wall lights by the headboard.
* **The repo is public: nothing personal.** No real entity ids, no household names, no personal room keys, in code, tests, docs or the screenshot. Entity defaults are `null` (only `sun.sun`); default names describe the room, not a person. Before a release, `git grep` for the owner's entity ids and names must come back empty. The owner's real config lives only in his Home Assistant config.
* Drawing style: white surfaces, `#111` outlines, amber gradient for lit rooms, black glass at night, silver by day. No glows or halos around lamps (the owner asked to remove them). The drawing colours do not follow the theme.
* Text in the drawing is counter-scaled (`tx()`), because the front of the house is drawn at 0.876 width to make room for the garden side. When redrawing, check labels against fans, lamps and the shower in a real browser at 360 and 520 px (Playwright with a stub `ha-card` that has a shadow root with `:host { display: block }`).
* Taps send an explicit `homeassistant.turn_on` / `turn_off`, never a toggle. Optimistic state per entity, confirmed by the target state, rolled back by another `last_changed` or after 5 s, with a failure flash on the part that was tapped.
* The drawing is rebuilt only when `_sceneValues` changes (`_sceneKey`); keyboard focus is restored after a rebuild.
* Visual editor: fields show the defaults; only non-defaults are written; a cleared default is written as `null`; unknown keys are kept.
* `const VERSION` stays on its own line for the Release workflow.

## Releasing

1. Changes go through a pull request; the owner merges.
2. Bump `VERSION`, add the CHANGELOG section in the PR that is meant to become a release.
3. The owner pushes the `vX.Y.Z` tag. **Never tag or release without the owner's explicit go.**
