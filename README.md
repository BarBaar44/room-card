# Room Card

The whole house in one Home Assistant dashboard card. Instead of a tile per room, it draws the house as a cut-away line drawing, in the style of the [Tesla Model 3](https://github.com/BarBaar44/tesla-model3-card) and [Gardenview House](https://github.com/BarBaar44/gardenview-house) cards: every room in its place, lit rooms glowing, the garden side of the house next to it.

![Room Card at night (dark theme) and by day (light theme)](https://raw.githubusercontent.com/BarBaar44/room-card/main/shot.png)

One JavaScript file, no build step, no dependencies, no card_mod, no Jinja.

The drawing is the owner's house: an attic with a dakkapel on both sides (two rooms), a first floor with four rooms (two bedrooms, an office, a bathroom), and a ground floor with the hallway and stairs and the living room with an open kitchen behind it. The rooms stay where the drawing puts them; which entities they show is up to you.

## What it shows

| Part | Shows |
|---|---|
| Name row | The card name, or the first warning: `Front door open`, `Garden doors open`, `Kitchen door open`, `Living window open` (red), then `Office light unavailable` (amber). `+2` when there are more |
| Big number | How many room lights and bed lights are on, or `All off` |
| Status line | Only what matters now: `Shower running`, `Bath 78 %, fan on` (humidity at or above `humidity_alert`), `Living heating to 21,5°` (or `Heating Living, Bedroom 1`). With nothing going on: the average inside temperature |
| Rooms | Short name and temperature (1 decimal, your locale). A lit room glows amber; a dark room is black glass at night and silver by day. An unavailable light dims its room |
| Bedrooms | `attic_left` and `first_1`: a bed light by the headboard that turns yellow when on. `first_3`: a ceiling fan that spins when on |
| Bathroom | Shower cabin with running water while the shower is on; steam and the humidity in blue at or above `humidity_alert` or while showering; air rising into the ceiling extractor while the fan runs |
| Living room | Radiator that glows with heat waves while its thermostat is heating; open passage to the kitchen |
| Kitchen | Lit by day; at night dark, or warm while `kitchen_light` is on. Its door and window on the garden side follow the same |
| Garden side | The facade from the Gardenview House card: sun screen cassette, French doors, brick pier with the lantern, kitchen door and window. At night the French doors and the `first_3` window glow while that room's light is on; the bathroom window is frosted and glows pale |
| Sky | Moon at night, sun by day. Dark: the `dark` entity (on/off, or an illuminance sensor below `dark_below`), else the sun below the horizon |

## Using it

| Do | Result |
|---|---|
| Tap a room | Toggles its light. A room without a light opens its details |
| Hold a room (500 ms) | Details pop-up: temperature, humidity, thermostat, light, fan, bed light, shower, doors, window, motion. Tap a row for more-info |
| Tap a fan, bed light, the lantern or the kitchen | Toggles it. Hold: more-info |
| Tap the shower | More-info of the shower entity |
| All off button | Switches off every room light and bed light that is on, in one call |
| Keyboard | Tab to a room or device; Enter or Space taps, Shift+Enter holds |

Every toggle shows the new state at once and sends an explicit `homeassistant.turn_on` or `turn_off` for what you see, never a blind toggle. If HA reports another state, nothing comes within 5 s, or the call fails, the room or device rolls back with a short red flash and a failure vibration (and a notification when the call failed). Moving more than 10 px cancels a tap or hold, so scrolling never switches a light. Haptics in the companion app; animations stop under reduced motion.

The card re-renders only when one of its own entities changes, and rebuilds the drawing only when something in it changed.

## Install

Home Assistant Marketplace (formerly HACS) > three dots > Custom repositories > add `https://github.com/BarBaar44/room-card`, type **Dashboard**. Install, then reload the browser.

Needs HA 2024.11 or newer (`getGridOptions`).

## Configuration

`type: custom:room-card` alone renders the house with neutral names and no data. Add your entities per room, in the visual editor or in YAML. The card is 12 columns by 7 rows (440 px) by default, minimum 6 by 6. The editor only writes what differs from the defaults; a cleared default is written as `null`.

| Option | Default | |
|---|---|---|
| `name` | `Home` | Name row when there is no warning |
| `humidity_alert` | `70` | Bathroom humidity (%) for steam, the blue humidity and the status line |
| `dark_below` | `10` | lx, when `dark` is an illuminance sensor |
| `entities` | see below | House and garden |
| `rooms` | see below | Per room |
| `colors` | | `warn` (doors, default red), `notice` (unavailable, default amber). Also as `--rc-warn` and `--rc-notice` theme variables |

`entities` (all optional):

| Key | Default | |
|---|---|---|
| `dark` | none | Illuminance sensor, or a binary_sensor / input_boolean that is on when dark. None: the sun |
| `sun` | `sun.sun` | |
| `lantern` | none | Garden lantern (light or switch) |
| `kitchen_light` | none | Without it, the kitchen is lit by day and dark at night |
| `front_door`, `garden_door`, `kitchen_door` | none | binary_sensor, on = open |

`rooms`: the keys name the place in the drawing. Each room takes `name` (details pop-up), `short_name` (in the drawing; defaults to `name` when only `name` is set), `temperature`, `humidity`, `light` (tapping the room), `climate` (thermostat), plus the parts the drawing has for that room. Every entity defaults to none.

| Key | Place in the drawing | Default name (short) | Extra roles |
|---|---|---|---|
| `attic_left` | attic, left (bed under the dakkapel) | Attic bedroom (Attic) | `bed_light` |
| `attic_right` | attic, right (bike) | Gym | |
| `first_1` | first floor, 1st from the left (bed) | Bedroom 1 | `bed_light` |
| `first_2` | first floor, 2nd (desk) | Office | |
| `first_3` | first floor, 3rd (king bed, ceiling fan) | Main bedroom (Bedroom) | `fan`, `door` |
| `first_4` | first floor, right (shower) | Bathroom (Bath) | `fan`, `shower` |
| `ground_left` | ground floor, left (hallway, stairs) | Hallway (Hall) | `occupancy` |
| `ground_right` | ground floor, right (living room, kitchen) | Living room (Living) | `window` |

```yaml
type: custom:room-card
entities:
  dark: sensor.outdoor_illuminance
  front_door: binary_sensor.front_door
rooms:
  first_4:
    temperature: sensor.bathroom_temperature
    humidity: sensor.bathroom_humidity
    light: light.bathroom
    fan: switch.bathroom_fan
    shower: binary_sensor.shower
  ground_right:
    temperature: sensor.living_room_temperature
    light: light.living_room
    climate: climate.living_room
```

`rooms.yaml` has every option filled in with made-up entity ids. `light`, `bed_light` and `fan` must be something that switches (light, switch, fan, input_boolean). `shower` may be a binary_sensor, input_boolean or switch; it is shown, not switched.

## Upgrading

**From v0.3:** the room keys were renamed to places in the drawing and the defaults no longer contain entities. An old room key gives an error that lists the valid keys. Move each room's options to its new key (see the table above: attic left and right, first floor 1 to 4 from the left, ground floor left and right) and add the entities that used to be defaults.

**From v0.2:** v0.2 was a tile per room (`temperature`, `main`, `chips`); those options give an error. Replace the room tiles with one `type: custom:room-card` card (12 by 7).

## Design decisions

| Decision | Why |
|---|---|
| One card with the house drawn, not tiles or floor groups | One status line and one All off for the whole house; less space than a tile per room; looks like the sister cards |
| Rooms are fixed places in the drawing, keys named after the place | It is one specific house, like Gardenview House; entities and names stay configurable |
| No entity defaults | The repository is public: nothing about a household belongs in it |
| Tap a room toggles, hold opens details | Keeps the v0.2 tap/hold habit; details replace the chips |
| Explicit turn_on / turn_off with rollback | Two quick taps can never end up out of sync with the screen; a device that does not respond is easy to spot |
| Plain `HTMLElement`, one block scope | HA does not export Lit officially; no name clashes with the sister cards |
| Drawing colours stay the same in light and dark themes | Like the Tesla and Gardenview cards: the house is white with black outlines; night and day come from the outside light, not the theme |
| Only what matters now in the status line | Warnings in the name row, everything else in the details pop-up |
