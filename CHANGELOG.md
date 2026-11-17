# Changelog

## v0.4.1

### Changed
* The dakkapellen are drawn in perspective: their flat roofs run back along the roof like the garden side, and the right one shows its side with a window.
* No sun or moon in the sky. Night and day still show in the rooms (black glass or silver).

## v0.4.0

### Breaking
* **Room keys renamed to places in the drawing:** `attic_left`, `attic_right`, `first_1`, `first_2`, `first_3`, `first_4` (first floor, from the left), `ground_left`, `ground_right`. The old keys give an error that lists the valid ones; move each room's options to its new key.
* **No entity defaults.** Every room role and every house entity (`dark`, `lantern`, `front_door`, `garden_door`, `kitchen_door`) now defaults to none; only `sun` keeps `sun.sun`. Add your entities in the editor or YAML. Without a `dark` entity the card uses the sun.
* Default room names are neutral (Attic bedroom, Gym, Bedroom 1, Office, Main bedroom, Bathroom, Hallway, Living room).

### Changed
* Renamed personal defaults: the repository no longer contains anything about a household. README, `rooms.yaml` (now an example with made-up entity ids), tests and the screenshot use generic names.
* An empty config renders the house with neutral names and no data.

Look, animations, tap and hold, the status line, the editor and the 12 x 7 size are unchanged.

## v0.3.0

### New
* **The whole house in one card.** A cut-away line drawing of the house in the style of the Tesla Model 3 and Gardenview House cards replaces the room tiles: an attic with two rooms and a dakkapel on both sides, a first floor with four rooms, a ground floor with the hallway and the living room with an open kitchen, and the garden facade from the sun screen card on the right.
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
* The room tile is gone. `temperature`, `main` and `chips` give an error: replace the room tiles with one `type: custom:room-card` card. Defaults are 12 columns by 7 rows.
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
