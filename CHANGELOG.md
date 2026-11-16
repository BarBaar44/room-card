# Changelog

## v0.3.0

### New
* **The whole house in one card.** A cut-away line drawing of the house in the style of the Tesla Model 3 and Gardenview House cards replaces the eight room tiles: attic (Tim, Sport Room) with a dakkapel on both sides, first floor (Gijs, Office, Master bedroom, Bathroom), ground floor (Hallway, Living Room with the open kitchen), and the garden facade from the sun screen card on the right.
* Every room shows its short name and temperature. A lit room glows amber; a dark room is black glass at night and silver by day (`dark` entity below `dark_below`, else the sun).
* Fans spin, bed lights turn yellow, the shower runs, steam and the humidity show in the bathroom at or above `humidity_alert`, the living room radiator glows while heating, the kitchen follows day, night and its own light, and the garden side windows glow with the rooms behind them.
* Name row with warnings (doors and window open in red, unavailable lights in amber), the number of lights on as the big number, and a short status line.
* All off button: one call for every room light and bed light that is on.
* Hold a room for a details pop-up (climate, controls, doors and sensors); rows open more-info.
* Visual editor for every entity and threshold. It shows the defaults and only writes what differs; a cleared default becomes `null`.
* Keyboard: Tab to a room or device, Enter or Space taps, Shift+Enter holds.

### Kept
* Tap toggles with an explicit turn_on or turn_off, instant feedback, rollback after 5 s or when HA reports another state, a failure flash and vibration, and a notification when the call fails. Moving more than 10 px cancels a tap or hold.
* Re-renders only when one of its own entities changes.

### Breaking
* The room tile is gone. `temperature`, `main` and `chips` give an error: replace the eight tiles with one `type: custom:room-card` card. Defaults are 12 columns by 7 rows.
* `colors` now only has `warn` and `notice`.

## v0.2.0

### New
* **Visual editor.** Add and edit the card from the dashboard UI with HA's own entity and icon pickers. It has collapsible sections for the main button, up to 3 chips and colours. Colour fields offer the theme names and also accept any typed CSS colour. Options the editor does not show, such as `grid_options`, are kept.

### Changed
* **Default colour is now yellow** for the main button and for chips with a `light.` entity. Other chips keep amber. `color: auto` falls back to yellow when the light reports no colour.
* **Brightness bar removed.** Brightness is only shown as an optional percentage after the temperature (`brightness: percent`). The default is now hidden.

### Breaking
* `brightness: bar` is no longer valid and shows an error card. Use `percent` or remove the option.
* The `bar` and `bar_background` keys under `colors` are removed.
* Main buttons without a `color` turn yellow instead of amber. Set `color: amber` to keep the old look.

## v0.1.0

First release. A fast, lightweight room tile for Home Assistant sections views: one JavaScript file, no dependencies, no card_mod, no Jinja.

* Room name and temperature (1 decimal, your locale)
* Big round main button in the bottom left corner, coloured when on, grey when off
* Up to 3 chips on the right: toggles (switch, light, fan, input_boolean, scene, script) or status only (e.g. a door contact)
* Brightness bar or percentage for dimmable lights
* Instant feedback: a tap shows the new state right away and HA confirms it
* Failed taps roll back with a red ring and a short shake, after 5 s without response or when the call fails
* Tap toggles, hold (500 ms) opens more-info, with ripple and haptics in the companion app
* Re-renders only when one of its own entities changes
* Unavailable or missing entities are dimmed with a warning badge
* Every colour is configurable per card (`colors:`) or from a theme
* Light and dark theme support, `prefers-reduced-motion` respected
* Sized for sections views: 6 columns by 2 rows by default
* Clear error card for invalid config, including misspelled options
