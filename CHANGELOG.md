# Changelog

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
