/*! room-card | MIT | https://github.com/BarBaar44/room-card */
/*
 * Room Card
 * A Lovelace card for the whole house: a cut-away line drawing of the owner's
 * house (in the style of the Tesla Model 3 and Gardenview House cards) with
 * every room in place. A lit room glows amber, a dark one is black glass at
 * night and silver by day. Each room shows its name and temperature; fans
 * spin, bed lights shine, the shower runs, steam rises when the bathroom is
 * humid, the living room radiator glows while heating, and the garden side
 * (sun screen cassette, French doors, lantern, kitchen door and window) is the
 * facade from the Gardenview House card.
 *
 * Tap a room: toggle its light. Hold a room: details pop-up. Tap a fan, bed
 * light, lantern or the kitchen: toggle it; hold: more-info.
 *
 * Single file, no build step, no dependencies, no card_mod, no Jinja.
 */

// Everything sits in one block so the top-level names cannot clash with the
// sister cards when the files are loaded as classic scripts.
{
const VERSION = "0.4.1";

const RC_HOLD_MS = 500;
const RC_MOVE_PX = 10;
const RC_ROLLBACK_MS = 5000;
const RC_FAIL_MS = 1200;

/* The rooms are fixed places in the drawing (the owner's house). */
const RC_SLOTS = ["attic_left", "attic_right", "first_1", "first_2", "first_3", "first_4", "ground_left", "ground_right"];
const RC_FLOORS = { attic_left: "Attic", attic_right: "Attic", first_1: "First floor", first_2: "First floor", first_3: "First floor", first_4: "First floor", ground_left: "Ground floor", ground_right: "Ground floor" };

/* Per room: which extra roles the drawing has a place for. */
const RC_ROOM_ROLES = {
  attic_left: ["bed_light"],
  attic_right: [],
  first_1: ["bed_light"],
  first_2: [],
  first_3: ["fan", "door"],
  first_4: ["fan", "shower"],
  ground_left: ["occupancy"],
  ground_right: ["window"],
};
const RC_COMMON_ROLES = ["temperature", "humidity", "light", "climate"];
const RC_ROOM_TEXT = ["name", "short_name"];

const RC_DEFAULTS = {
  name: "Home",
  humidity_alert: 70, // % humidity in the bathroom: steam and a line in the status
  dark_below: 10, // lx, only when `dark` is an illuminance sensor
  entities: {
    dark: null, // binary_sensor / input_boolean (on = dark) or an illuminance sensor; null: the sun
    sun: "sun.sun",
    lantern: null,
    kitchen_light: null, // null: the kitchen is lit by day and dark at night
    front_door: null,
    garden_door: null,
    kitchen_door: null,
  },
  /* Every role defaults to null (not shown). Names describe the place in the drawing. */
  rooms: {
    attic_left: { name: "Attic bedroom", short_name: "Attic" },
    attic_right: { name: "Gym", short_name: "Gym" },
    first_1: { name: "Bedroom 1", short_name: "Bedroom 1" },
    first_2: { name: "Office", short_name: "Office" },
    first_3: { name: "Main bedroom", short_name: "Bedroom" },
    first_4: { name: "Bathroom", short_name: "Bath" },
    ground_left: { name: "Hallway", short_name: "Hall" },
    ground_right: { name: "Living room", short_name: "Living" },
  },
};

/* colors key -> CSS variable and default. */
const RC_COLORS = {
  warn: ["--rc-warn", "var(--red-color, #f44336)"],
  notice: ["--rc-notice", "var(--amber-color, #ffc107)"],
};

const RC_TOP_KEYS = new Set(["type", "name", "humidity_alert", "dark_below", "entities", "rooms", "colors",
  "grid_options", "layout_options", "view_layout", "visibility", "card_mod"]);
const RC_TOGGLE = new Set(["switch", "light", "fan", "input_boolean"]);
const RC_BAD = ["unknown", "unavailable", "none", ""];
const rcDomain = (id) => String(id).split(".", 1)[0];
const rcIsId = (v) => typeof v === "string" && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v);
const rcNum = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const rcEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rcReduced = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let rcUid = 0;

/* ------------------------------------------------------------------------ */
/* Config                                                                   */
/* ------------------------------------------------------------------------ */

function rcCheckKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new Error(`${where}: unknown option '${k}'. Allowed: ${[...allowed].join(", ")}`);
  }
}

function rcEntity(v, where) {
  if (v === null || v === undefined || v === "") return null;
  if (!rcIsId(v)) throw new Error(`${where}: '${v}' is not a valid entity id`);
  return v;
}

/* Merge the user's config over the defaults. null switches a default off. */
function rcNormalize(config) {
  if (!config || typeof config !== "object") throw new Error("Invalid configuration");
  if (config.chips !== undefined || config.main !== undefined || config.temperature !== undefined) {
    throw new Error("room-card v0.3 shows the whole house in one card. The v0.2 options (temperature, main, chips) are gone: remove them, see the README");
  }
  rcCheckKeys(config, RC_TOP_KEYS, "room-card");
  const out = {
    name: config.name !== undefined ? String(config.name || "") : RC_DEFAULTS.name,
    humidity_alert: RC_DEFAULTS.humidity_alert,
    dark_below: RC_DEFAULTS.dark_below,
    entities: { ...RC_DEFAULTS.entities },
    rooms: {},
    colors: {},
  };
  for (const k of ["humidity_alert", "dark_below"]) {
    if (config[k] !== undefined && config[k] !== null) {
      const n = rcNum(config[k]);
      if (n === null) throw new Error(`${k} must be a number`);
      out[k] = n;
    }
  }
  const ents = config.entities || {};
  if (typeof ents !== "object" || Array.isArray(ents)) throw new Error("entities must be a mapping");
  rcCheckKeys(ents, new Set(Object.keys(RC_DEFAULTS.entities)), "entities");
  for (const [k, v] of Object.entries(ents)) out.entities[k] = rcEntity(v, `entities.${k}`);

  const rooms = config.rooms || {};
  if (typeof rooms !== "object" || Array.isArray(rooms)) throw new Error("rooms must be a mapping");
  for (const k of Object.keys(rooms)) {
    if (!RC_SLOTS.includes(k)) {
      throw new Error(`rooms: unknown room key '${k}'. Since v0.4 the keys name the place in the drawing; valid keys are ${RC_SLOTS.join(", ")} (see the README)`);
    }
  }
  for (const slot of RC_SLOTS) {
    const def = RC_DEFAULTS.rooms[slot];
    const raw = rooms[slot] || {};
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`rooms.${slot} must be a mapping`);
    const roles = [...RC_COMMON_ROLES, ...RC_ROOM_ROLES[slot]];
    rcCheckKeys(raw, new Set([...RC_ROOM_TEXT, ...roles]), `rooms.${slot}`);
    const r = { slot, name: def.name, short_name: def.short_name };
    for (const t of RC_ROOM_TEXT) if (raw[t] !== undefined && raw[t] !== null && raw[t] !== "") r[t] = String(raw[t]);
    if (raw.name !== undefined && raw.short_name === undefined) r.short_name = r.name;
    for (const role of roles) {
      r[role] = role in raw ? rcEntity(raw[role], `rooms.${slot}.${role}`) : (def[role] === undefined ? null : def[role]);
    }
    for (const role of ["light", "fan", "bed_light"]) {
      if (r[role] && !RC_TOGGLE.has(rcDomain(r[role]))) {
        throw new Error(`rooms.${slot}.${role}: '${r[role]}' cannot be switched (use a light, switch, fan or input_boolean)`);
      }
    }
    out.rooms[slot] = r;
  }
  if (config.colors !== undefined && config.colors !== null) {
    if (typeof config.colors !== "object" || Array.isArray(config.colors)) throw new Error("colors must be a mapping");
    rcCheckKeys(config.colors, new Set(Object.keys(RC_COLORS)), "colors");
    for (const [k, v] of Object.entries(config.colors)) out.colors[RC_COLORS[k][0]] = String(v);
  }
  return out;
}

/* Every entity the card reads, for change detection. */
function rcEntityIds(c) {
  const ids = Object.values(c.entities);
  for (const r of Object.values(c.rooms)) {
    for (const [k, v] of Object.entries(r)) if (!["slot", "name", "short_name"].includes(k)) ids.push(v);
  }
  return [...new Set(ids.filter(Boolean))];
}

/* ------------------------------------------------------------------------ */
/* The drawing (generated from the approved mockup; see README)             */
/* ------------------------------------------------------------------------ */

const rcScene = (v) => `<defs>
      <linearGradient id="${v.uid}-lit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffeab0"></stop><stop offset="1" stop-color="#ffc552"></stop></linearGradient>
      <linearGradient id="${v.uid}-day" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6e9eb"></stop><stop offset="1" stop-color="#b7bdc2"></stop></linearGradient>
      <linearGradient id="${v.uid}-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6cf" stop-opacity=".95"></stop><stop offset="1" stop-color="#ffe082" stop-opacity="0"></stop></linearGradient>
    </defs>
<polygon points="4,320 302,320 366,300 40,300" fill="#000" opacity=".35"></polygon>
<polygon points="300.0,104.0 360.0,84.0 360.0,293.0 300.0,313.0" fill="#b97c6e" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon>
<g><line x1="300.0" y1="110.0" x2="360.0" y2="90.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="115.0" x2="360.0" y2="95.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="120.0" x2="360.0" y2="100.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="125.0" x2="360.0" y2="105.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="130.0" x2="360.0" y2="110.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="135.0" x2="360.0" y2="115.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="140.0" x2="360.0" y2="120.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="145.0" x2="360.0" y2="125.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="150.0" x2="360.0" y2="130.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="155.0" x2="360.0" y2="135.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="160.0" x2="360.0" y2="140.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="165.0" x2="360.0" y2="145.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="170.0" x2="360.0" y2="150.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="175.0" x2="360.0" y2="155.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="180.0" x2="360.0" y2="160.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="185.0" x2="360.0" y2="165.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="190.0" x2="360.0" y2="170.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="195.0" x2="360.0" y2="175.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="200.0" x2="360.0" y2="180.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="205.0" x2="360.0" y2="185.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="210.0" x2="360.0" y2="190.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="215.0" x2="360.0" y2="195.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="220.0" x2="360.0" y2="200.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="225.0" x2="360.0" y2="205.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="230.0" x2="360.0" y2="210.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="235.0" x2="360.0" y2="215.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="240.0" x2="360.0" y2="220.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="245.0" x2="360.0" y2="225.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="250.0" x2="360.0" y2="230.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="255.0" x2="360.0" y2="235.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="260.0" x2="360.0" y2="240.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="265.0" x2="360.0" y2="245.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="270.0" x2="360.0" y2="250.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="275.0" x2="360.0" y2="255.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="280.0" x2="360.0" y2="260.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="285.0" x2="360.0" y2="265.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="290.0" x2="360.0" y2="270.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="295.0" x2="360.0" y2="275.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="300.0" x2="360.0" y2="280.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="305.0" x2="360.0" y2="285.0" stroke="#8f5a4f" stroke-width="0.45"></line><line x1="300.0" y1="310.0" x2="360.0" y2="290.0" stroke="#8f5a4f" stroke-width="0.45"></line></g>
<polygon points="308.0,125.3 324.0,120.0 324.0,172.0 308.0,177.3" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="309.6,127.8 322.4,123.5 322.4,169.5 309.6,173.8" fill="${v.sideGlass.first_3}" stroke="#111" stroke-width=".8"></polygon><line x1="316.0" y1="125.7" x2="316.0" y2="171.7" stroke="#f4f2ee" stroke-width="2"></line><line x1="316.0" y1="125.7" x2="316.0" y2="171.7" stroke="#111" stroke-width="0.5"></line><polygon points="307.0,177.7 325.0,171.7 325.0,174.7 307.0,180.7" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon>
<polygon points="336.0,116.0 352.0,110.7 352.0,162.7 336.0,168.0" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="337.6,118.5 350.4,114.2 350.4,160.2 337.6,164.5" fill="${v.sideGlass.first_4}" stroke="#111" stroke-width=".8"></polygon><line x1="344.0" y1="116.3" x2="344.0" y2="162.3" stroke="#f4f2ee" stroke-width="2"></line><line x1="344.0" y1="116.3" x2="344.0" y2="162.3" stroke="#111" stroke-width="0.5"></line><polygon points="335.0,168.3 353.0,162.3 353.0,165.3 335.0,171.3" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon>
<polygon points="300.0,210.0 360.0,190.0 360.0,208.0 300.0,228.0" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon>
<polygon points="301.0,212.7 359.0,193.3 359.0,201.3 301.0,220.7" fill="#fbfaf7" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon>
<line x1="302.0" y1="221.8" x2="358.0" y2="203.2" stroke="${v.hemColor}" stroke-width="1.6"></line>
<polygon points="302.0,228.3 326.0,220.3 326.0,303.3 302.0,311.3" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon>
<polygon points="303.0,229.0 314.0,225.3 314.0,307.3 303.0,311.0" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="304.6,231.5 312.4,228.9 312.4,281.9 304.6,284.5" fill="${v.sideGlass.ground_right}" stroke="#111" stroke-width=".8"></polygon><polygon points="304.6,288.5 312.4,285.9 312.4,304.9 304.6,307.5" fill="#fbfaf7" stroke="#111" stroke-width=".8"></polygon>
<polygon points="314.0,225.3 325.0,221.7 325.0,303.7 314.0,307.3" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="315.6,227.8 323.4,225.2 323.4,278.2 315.6,280.8" fill="${v.sideGlass.ground_right}" stroke="#111" stroke-width=".8"></polygon><polygon points="315.6,284.8 323.4,282.2 323.4,301.2 315.6,303.8" fill="#fbfaf7" stroke="#111" stroke-width=".8"></polygon>
<line x1="312.6" y1="257.8" x2="312.6" y2="265.8" stroke="#333" stroke-width="1.2"></line><line x1="315.4" y1="256.9" x2="315.4" y2="264.9" stroke="#333" stroke-width="1.2"></line>
<g class="hit ${v.cls.lantern}" data-act="lantern" role="button" tabindex="0" aria-label="Garden lantern"><circle cx="331.0" cy="239.7" r="13" fill="transparent"></circle><line x1="331.0" y1="229.7" x2="331.0" y2="233.7" stroke="#111" stroke-width="1.6"></line><polygon points="327.5,234.8 334.5,232.5 331.0,230.2" fill="#111"></polygon><polygon points="328.0,234.7 334.0,232.7 334.0,244.7 328.0,246.7" fill="${v.lanternGlass}" stroke="#111" stroke-width="1.6"></polygon><polygon points="327.5,246.8 334.5,244.5 334.5,246.5 327.5,248.8" fill="#111" ></polygon></g>
<polygon points="337.0,216.7 349.0,212.7 349.0,295.7 337.0,299.7" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon>
<polygon points="338.6,219.1 347.4,216.2 347.4,268.2 338.6,271.1" fill="${v.kitchenGlass}" stroke="#111" stroke-width=".8"></polygon>
<polygon points="338.6,275.1 347.4,272.2 347.4,293.2 338.6,296.1" fill="#fbfaf7" stroke="#111" stroke-width=".8"></polygon>
<line x1="340.2" y1="248.6" x2="340.2" y2="256.6" stroke="#333" stroke-width="1.2"></line>
<polygon points="351.0,215.0 358.0,212.7 358.0,248.7 351.0,251.0" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="352.6,217.5 356.4,216.2 356.4,246.2 352.6,247.5" fill="${v.kitchenGlass}" stroke="#111" stroke-width=".8"></polygon><polygon points="350.0,251.3 359.0,248.3 359.0,251.3 350.0,254.3" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon>
<polygon points="300.0,312.0 360.0,292.0 360.0,298.0 300.0,318.0" fill="#111" ></polygon>
<rect x="174" y="2" width="12.3" height="22" fill="#b97c6e" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></rect><rect x="171.5" y="-2" width="17.5" height="5" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></rect>
<polygon points="309,110 159,6 219,-14 369,90" fill="#3a3331" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon>
<polygon points="33.8,35.0 122.2,35.0 166.2,20.3 77.8,20.3" fill="#4a403c" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="33.8,33.0 33.8,36.0 77.8,21.3 77.8,18.3" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon><polygon points="278.2,36.0 322.2,21.3 322.2,74.0 278.2,88.7" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><line x1="278.2" y1="44.0" x2="322.2" y2="29.3" stroke="#c9c5bd" stroke-width=".6"></line><line x1="278.2" y1="50.0" x2="322.2" y2="35.3" stroke="#c9c5bd" stroke-width=".6"></line><line x1="278.2" y1="56.0" x2="322.2" y2="41.3" stroke="#c9c5bd" stroke-width=".6"></line><line x1="278.2" y1="62.0" x2="322.2" y2="47.3" stroke="#c9c5bd" stroke-width=".6"></line><line x1="278.2" y1="68.0" x2="322.2" y2="53.3" stroke="#c9c5bd" stroke-width=".6"></line><line x1="278.2" y1="74.0" x2="322.2" y2="59.3" stroke="#c9c5bd" stroke-width=".6"></line><line x1="278.2" y1="80.0" x2="322.2" y2="65.3" stroke="#c9c5bd" stroke-width=".6"></line><polygon points="287.2,44.0 311.2,36.0 311.2,66.0 287.2,74.0" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="288.8,46.5 309.6,39.5 309.6,63.5 288.8,70.5" fill="${v.winGlass}" stroke="#111" stroke-width=".8"></polygon><line x1="299.2" y1="43.0" x2="299.2" y2="67.0" stroke="#f4f2ee" stroke-width="2"></line><polygon points="286.2,74.3 312.2,65.7 312.2,68.7 286.2,77.3" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon><polygon points="195.8,35.0 284.3,35.0 328.3,20.3 239.8,20.3" fill="#4a403c" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></polygon><polygon points="284.3,33.0 284.3,36.0 328.3,21.3 328.3,18.3" fill="#f4f2ee" stroke="#111" stroke-width="1"></polygon>
<g transform="matrix(0.876 0 0 1 2.232 0)">
<g class="room ${v.cls.attic_right}" data-act="attic_right" role="button" tabindex="0" aria-label="${v.aria.attic_right}"><polygon points="181,19 222,42 308,42 308,104 181,104" fill="${v.fill.attic_right}"></polygon><g fill="none" stroke="${v.ink.attic_right}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="252" cy="92" r="11"></circle><circle cx="284" cy="92" r="11"></circle><path d="M252 92l10-15h14l8 15M262 77l7 15h15M276 77l-1-5h-5M258 72h9"></path></g><text transform="matrix(1.1416 0 0 1 -26.753 0)" x="189" y="64" font-size="11" fill="${v.txt2.attic_right}">${v.label.attic_right}</text><text transform="matrix(1.1416 0 0 1 -26.753 0)" x="189" y="82" font-size="16" font-weight="500" fill="${v.txt.attic_right}" style="font-variant-numeric: tabular-nums">${v.temp.attic_right}</text></g>
<g class="room ${v.cls.attic_left}" data-act="attic_left" role="button" tabindex="0" aria-label="${v.aria.attic_left}"><polygon points="50,104 50,42 136,42 177,19 177,104" fill="${v.fill.attic_left}"></polygon><g fill="${v.ink.attic_left}"><rect x="56" y="66" width="6" height="38" rx="1.5"></rect><rect x="60" y="80" width="46" height="12" rx="3"></rect><rect x="64" y="92" width="4" height="12"></rect><rect x="99" y="92" width="4" height="12"></rect><rect x="65" y="73" width="15" height="7" rx="3.5"></rect></g><text transform="matrix(1.1416 0 0 1 -15.854 0)" x="112" y="64" font-size="11" fill="${v.txt2.attic_left}">${v.label.attic_left}</text><text transform="matrix(1.1416 0 0 1 -15.854 0)" x="112" y="82" font-size="16" font-weight="500" fill="${v.txt.attic_left}" style="font-variant-numeric: tabular-nums">${v.temp.attic_left}</text></g>
<g class="hit ${v.cls.bed_attic_left}" data-act="bed_attic_left" role="button" tabindex="0" aria-label="Bed light"><circle cx="72" cy="68" r="16" fill="transparent"></circle><path d="M62 59h10v4" fill="none" stroke="#111" stroke-width="1.8"></path><path d="M65.5 72l2.5-9h8l2.5 9z" fill="${v.spotColor.attic_left}" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></path><path d="M65.5 72h13" stroke="#111" stroke-width="1.4"></path></g>
<rect x="177" y="18" width="4" height="86" fill="#f4f2ee" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></rect>
<polygon points="131,35 179,6 227,35 222,42 179,18 136,42" fill="#4a403c" stroke="#111" stroke-width="2.2" stroke-linejoin="round"></polygon>
<polygon points="8,110 43,89 50,89 50,104 25,104" fill="#4a403c" stroke="#111" stroke-width="2.2" stroke-linejoin="round"></polygon>
<polygon points="350,110 315,89 308,89 308,104 333,104" fill="#4a403c" stroke="#111" stroke-width="2.2" stroke-linejoin="round"></polygon>
<path d="M131 35L179 6L227 35" fill="none" stroke="#f4f2ee" stroke-width="1.8" transform="translate(0,3.5)"></path>
<rect x="43" y="42" width="7" height="47" fill="#f4f2ee" stroke="#111" stroke-width="1.6"></rect>
<rect x="44.5" y="50" width="4" height="31" fill="${v.winGlass}" stroke="#111" stroke-width=".8"></rect>
<rect x="36" y="35" width="101" height="7" fill="#4a403c" stroke="#111" stroke-width="2" stroke-linejoin="round"></rect>
<rect x="36" y="33" width="101" height="3" fill="#f4f2ee" stroke="#111" stroke-width="1"></rect>
<rect x="308" y="42" width="7" height="47" fill="#f4f2ee" stroke="#111" stroke-width="1.6"></rect>
<rect x="309.5" y="50" width="4" height="31" fill="${v.winGlass}" stroke="#111" stroke-width=".8"></rect>
<rect x="221" y="35" width="101" height="7" fill="#4a403c" stroke="#111" stroke-width="2" stroke-linejoin="round"></rect>
<rect x="221" y="33" width="101" height="3" fill="#f4f2ee" stroke="#111" stroke-width="1"></rect>
<rect x="18" y="104" width="322" height="6" fill="#f4f2ee" stroke="#111" stroke-width="1.6"></rect>
<g class="room ${v.cls.first_1}" data-act="first_1" role="button" tabindex="0" aria-label="${v.aria.first_1}"><rect x="25" y="110" width="72" height="96" fill="${v.fill.first_1}"></rect><g fill="${v.ink.first_1}"><rect x="29" y="168" width="6" height="38" rx="1.5"></rect><rect x="33" y="182" width="60" height="12" rx="3"></rect><rect x="35" y="194" width="4" height="12"></rect><rect x="85" y="194" width="4" height="12"></rect><rect x="37" y="175" width="15" height="7" rx="3.5"></rect></g><text transform="matrix(1.1416 0 0 1 -4.671 0)" x="33" y="128" font-size="11" fill="${v.txt2.first_1}">${v.label.first_1}</text><text transform="matrix(1.1416 0 0 1 -4.671 0)" x="33" y="146" font-size="16" font-weight="500" fill="${v.txt.first_1}" style="font-variant-numeric: tabular-nums">${v.temp.first_1}</text></g>
<g class="hit ${v.cls.bed_first_1}" data-act="bed_first_1" role="button" tabindex="0" aria-label="Bed light"><circle cx="45" cy="166" r="16" fill="transparent"></circle><path d="M35 157h10v4" fill="none" stroke="#111" stroke-width="1.8"></path><path d="M38.5 170l2.5-9h8l2.5 9z" fill="${v.spotColor.first_1}" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></path><path d="M38.5 170h13" stroke="#111" stroke-width="1.4"></path></g>
<rect x="97" y="110" width="3" height="96" fill="#f4f2ee" stroke="#111" stroke-width="1"></rect>
<g class="room ${v.cls.first_2}" data-act="first_2" role="button" tabindex="0" aria-label="${v.aria.first_2}"><rect x="100" y="110" width="75" height="96" fill="${v.fill.first_2}"></rect><path d="M157 110v4" stroke="${v.ink.first_2}" stroke-width="1"></path><path d="M149 121l8-7 8 7z" fill="${v.ink.first_2}"></path><g fill="${v.ink.first_2}"><rect x="123" y="176" width="48" height="3" rx="1"></rect><rect x="126" y="179" width="3" height="27"></rect><rect x="165" y="179" width="3" height="27"></rect><rect x="136" y="158" width="24" height="15" rx="2"></rect><rect x="146" y="173" width="4" height="3"></rect></g><path d="M107 206v-16h10M114 190v-14" fill="none" stroke="${v.ink.first_2}" stroke-width="2.4" stroke-linecap="round"></path><text transform="matrix(1.1416 0 0 1 -15.288 0)" x="108" y="128" font-size="11" fill="${v.txt2.first_2}">${v.label.first_2}</text><text transform="matrix(1.1416 0 0 1 -15.288 0)" x="108" y="146" font-size="16" font-weight="500" fill="${v.txt.first_2}" style="font-variant-numeric: tabular-nums">${v.temp.first_2}</text></g>
<rect x="175" y="110" width="3" height="96" fill="#f4f2ee" stroke="#111" stroke-width="1"></rect>
<g class="room ${v.cls.first_3}" data-act="first_3" role="button" tabindex="0" aria-label="${v.aria.first_3}"><rect x="178" y="110" width="80" height="96" fill="${v.fill.first_3}"></rect><g fill="${v.ink.first_3}"><rect x="182" y="162" width="6" height="44" rx="1.5"></rect><rect x="186" y="182" width="70" height="12" rx="3"></rect><rect x="188" y="194" width="4" height="12"></rect><rect x="248" y="194" width="4" height="12"></rect><rect x="190" y="175" width="15" height="7" rx="3.5"></rect><rect x="207" y="175" width="15" height="7" rx="3.5"></rect></g><text transform="matrix(1.1416 0 0 1 -26.329 0)" x="186" y="128" font-size="11" fill="${v.txt2.first_3}">${v.label.first_3}</text><text transform="matrix(1.1416 0 0 1 -26.329 0)" x="186" y="146" font-size="16" font-weight="500" fill="${v.txt.first_3}" style="font-variant-numeric: tabular-nums">${v.temp.first_3}</text></g>
<g class="hit ${v.cls.fan_first_3}" data-act="fan_first_3" role="button" tabindex="0" aria-label="Ceiling fan"><circle cx="246" cy="132" r="16" fill="transparent"></circle><path d="M246 110v12" stroke="#111" stroke-width="1.4"></path><g class="${v.spin.fan_first_3}"><ellipse cx="246" cy="124" rx="2.2" ry="9" fill="${v.fanColor.fan_first_3}" stroke="#111" stroke-width=".8" transform="rotate(0 246 133)"></ellipse><ellipse cx="246" cy="124" rx="2.2" ry="9" fill="${v.fanColor.fan_first_3}" stroke="#111" stroke-width=".8" transform="rotate(120 246 133)"></ellipse><ellipse cx="246" cy="124" rx="2.2" ry="9" fill="${v.fanColor.fan_first_3}" stroke="#111" stroke-width=".8" transform="rotate(240 246 133)"></ellipse><circle cx="246" cy="133" r="3" fill="#f4f2ee" stroke="#111" stroke-width="1"></circle></g></g>
<rect x="258" y="110" width="3" height="96" fill="#f4f2ee" stroke="#111" stroke-width="1"></rect>
<g class="room ${v.cls.first_4}" data-act="first_4" role="button" tabindex="0" aria-label="${v.aria.first_4}"><rect x="261" y="110" width="72" height="96" fill="${v.fill.first_4}"></rect><g fill="none" stroke="${v.ink.first_4}"><path d="M325 204V161h-9" stroke-width="2"></path><path d="M318 161h-12l1.5 4h9z" fill="${v.ink.first_4}" stroke-width=".6"></path><rect x="300" y="153" width="30" height="51" rx="1" stroke-width="1.6" fill="#ffffff" fill-opacity=".14"></rect><path d="M300 200h30" stroke-width="3"></path></g><g fill="none" stroke="${v.steamColor}" stroke-width="1.6" stroke-linecap="round" opacity="${v.o.steam}"><path class="steam" d="M306 192c-4-5 4-8 0-13s4-8 0-12"></path><path class="steam b" d="M317 192c-4-5 4-8 0-13s4-8 0-12"></path></g><text transform="matrix(1.1416 0 0 1 -37.795 0)" x="267" y="128" font-size="11" fill="${v.txt2.first_4}">${v.label.first_4}</text><text transform="matrix(1.1416 0 0 1 -37.795 0)" x="267" y="146" font-size="16" font-weight="500" fill="${v.txt.first_4}" style="font-variant-numeric: tabular-nums">${v.temp.first_4}</text><g opacity="${v.o.steam}"><text transform="matrix(1.1416 0 0 1 -37.795 0)" x="267" y="164" font-size="11" font-weight="500" fill="${v.humColor}">${v.humText}</text></g></g>
<g class="hit ${v.cls.shower}" data-act="shower" role="button" tabindex="0" aria-label="Shower"><rect x="298" y="152" width="34" height="52" fill="transparent"></rect><g opacity="${v.o.shower}" stroke="${v.waterColor}" stroke-width="1.3" stroke-linecap="round"><path class="water" d="M308 166v33"></path><path class="water b" d="M311 166v33"></path><path class="water" d="M314 166v33"></path><path class="water b" d="M317 166v33"></path></g></g>
<g class="hit ${v.cls.fan_first_4}" data-act="fan_first_4" role="button" tabindex="0" aria-label="Ceiling extractor fan"><circle cx="316" cy="120" r="15" fill="transparent"></circle><rect x="306" y="110" width="20" height="6" rx="1" fill="${v.fanColor.fan_first_4}" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></rect><path d="M310 116v-4M314 116v-4M318 116v-4M322 116v-4" stroke="#111" stroke-width=".7"></path><g fill="none" stroke="${v.airColor}" stroke-width="1.5" stroke-linecap="round" opacity="${v.o.air}"><path class="air" d="M310 129c-2-3 2-5 0-8"></path><path class="air b" d="M316 130c-2-3 2-5 0-8"></path><path class="air" d="M322 129c-2-3 2-5 0-8"></path></g></g>
<rect x="18" y="206" width="322" height="6" fill="#f4f2ee" stroke="#111" stroke-width="1.6"></rect>
<g class="room ${v.cls.ground_left}" data-act="ground_left" role="button" tabindex="0" aria-label="${v.aria.ground_left}"><rect x="25" y="212" width="78" height="100" fill="${v.fill.ground_left}"></rect><path d="M84 212v6" stroke="${v.ink.ground_left}" stroke-width="1"></path><path d="M76 225l8-7 8 7z" fill="${v.ink.ground_left}"></path><path d="M103 212v10h-6.4v10h-6.4v10h-6.4v10h-6.4v10h-6.4v10h-6.4v10h-6.4v10h-6.4v10h-6.4v10h-6.4" fill="none" stroke="${v.ink.ground_left}" stroke-width="2.6" stroke-linejoin="round"></path><path d="M36 262v40M31 268h10M31 276h10M32 302h8" stroke="${v.ink.ground_left}" stroke-width="2.2" stroke-linecap="round"></path><text transform="matrix(1.1416 0 0 1 -4.671 0)" x="33" y="230" font-size="11" fill="${v.txt2.ground_left}">${v.label.ground_left}</text><text transform="matrix(1.1416 0 0 1 -4.671 0)" x="33" y="248" font-size="16" font-weight="500" fill="${v.txt.ground_left}" style="font-variant-numeric: tabular-nums">${v.temp.ground_left}</text></g>
<rect x="103" y="212" width="4" height="100" fill="#f4f2ee" stroke="#111" stroke-width="1"></rect>
<g class="room ${v.cls.ground_right}" data-act="ground_right" role="button" tabindex="0" aria-label="${v.aria.ground_right}"><rect x="107" y="212" width="226" height="100" fill="${v.fill.ground_right}"></rect><g class="hit ${v.cls.kitchen}" data-act="kitchen" role="button" tabindex="0" aria-label="Kitchen light"><rect x="280" y="228" width="44" height="84" fill="#a9d8c6"></rect><path d="M280 236h44M280 244h44M280 252h44M280 260h44M280 268h44M280 276h44M288 228v50M296 228v50M304 228v50M312 228v50M320 228v50" stroke="#8fc3b0" stroke-width=".6"></path><rect x="280" y="232" width="44" height="14" fill="#fbfaf7" stroke="#111" stroke-width="1"></rect><path d="M302 232v14" stroke="#111" stroke-width=".8"></path><rect x="280" y="281" width="44" height="31" fill="#fbfaf7" stroke="#111" stroke-width="1"></rect><path d="M302 281v31M292 288h4M308 288h4" stroke="#111" stroke-width=".8"></path><rect x="279" y="277" width="46" height="4" fill="#111"></rect><rect x="280" y="228" width="44" height="84" fill="#ffc552" opacity="${v.o.kitchenWarm}"></rect><rect x="280" y="228" width="44" height="84" fill="#000" opacity="${v.o.kitchenDim}"></rect><path d="M280 312V228h44v84" fill="none" stroke="#111" stroke-width="1.6"></path></g><path d="M220 212v8" stroke="${v.ink.ground_right}" stroke-width="1"></path><path d="M212 227l8-7 8 7z" fill="${v.ink.ground_right}"></path><g fill="${v.ink.ground_right}"><rect x="182" y="266" width="80" height="16" rx="4"></rect><rect x="176" y="276" width="92" height="20" rx="4"></rect><rect x="182" y="296" width="4" height="16"></rect><rect x="258" y="296" width="4" height="16"></rect><rect x="152" y="286" width="18" height="3"></rect><rect x="159" y="289" width="4" height="23"></rect><path d="M154 284l3-12h8l3 12z"></path></g><rect x="114" y="276" width="30" height="24" rx="2" fill="${v.radFill}" stroke="#111" stroke-width="1.4" stroke-linejoin="round"></rect><path d="M119 279v18M124 279v18M129 279v18M134 279v18M139 279v18" stroke="#111" stroke-width=".8"></path><g class="heat" fill="none" stroke="#ff8a3d" stroke-width="1.6" stroke-linecap="round" opacity="${v.o.heat}"><path d="M121 271c-3-4 3-6 0-10"></path><path d="M129 271c-3-4 3-6 0-10"></path><path d="M137 271c-3-4 3-6 0-10"></path></g><text transform="matrix(1.1416 0 0 1 -16.279 0)" x="115" y="230" font-size="11" fill="${v.txt2.ground_right}">${v.label.ground_right}</text><text transform="matrix(1.1416 0 0 1 -16.279 0)" x="115" y="248" font-size="16" font-weight="500" fill="${v.txt.ground_right}" style="font-variant-numeric: tabular-nums">${v.temp.ground_right}</text></g>
<rect x="18" y="104" width="7" height="208" fill="#f4f2ee" stroke="#111" stroke-width="1.8"></rect>
<rect x="333" y="104" width="7" height="208" fill="#f4f2ee" stroke="#111" stroke-width="1.8"></rect>
<rect x="334.5" y="131" width="4" height="48" fill="${v.sideGlass.first_3}" stroke="#111" stroke-width=".8"></rect>
<rect x="334.5" y="231" width="4" height="58" fill="${v.sideGlass.ground_right}" stroke="#111" stroke-width=".8"></rect>
<rect x="10" y="312" width="342" height="7" fill="#111"></rect>
</g>`;

/* ------------------------------------------------------------------------ */
/* The card                                                                 */
/* ------------------------------------------------------------------------ */

const RC_STYLE = `
  :host {
${Object.values(RC_COLORS).map(([v, d]) => `    ${v}: ${d};`).join("\n")}
    display: block; height: 100%;
  }
  ha-card {
    height: 100%; box-sizing: border-box; overflow: hidden;
    display: flex; flex-direction: column; padding: 12px 12px 10px;
    user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .head { flex: none; display: flex; align-items: flex-start; gap: 10px; padding: 0 2px 0 4px; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.warn { color: var(--rc-warn); }
  .name.notice { color: var(--rc-notice); }
  .big { font-size: 28px; font-weight: 500; letter-spacing: -.5px; line-height: 32px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .big small { font-size: 14px; font-weight: 400; letter-spacing: 0; color: var(--secondary-text-color); margin-left: 3px; }
  .big.word { font-size: 21px; }
  .line { font-size: 12px; line-height: 16px; min-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  button {
    width: 32px; height: 32px; padding: 0; border: none; border-radius: 10px; cursor: pointer; font: inherit; flex: none;
    display: flex; align-items: center; justify-content: center;
    background: var(--secondary-background-color, rgba(127,127,127,.15)); color: var(--primary-text-color);
  }
  button ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; display: flex; }
  button:disabled { opacity: .28; cursor: default; }
  button:focus-visible { outline: 2px solid var(--primary-color); }

  .pic { flex: 1; min-height: 0; margin-top: 6px; touch-action: manipulation; }
  .pic svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .room, .hit { cursor: pointer; outline: none; transition: filter 120ms ease; }
  .hit.na { cursor: default; }
  .room:focus-visible, .hit:focus-visible { filter: drop-shadow(0 0 1.5px var(--primary-color)) drop-shadow(0 0 1.5px var(--primary-color)); }
  .pressed { filter: brightness(.88); }
  .unavail { opacity: .5; }
  .failed { animation: rc-fail ${RC_FAIL_MS}ms ease-out; }
  @keyframes rc-fail {
    0%, 55% { filter: drop-shadow(0 0 2px var(--error-color, #db4437)) drop-shadow(0 0 2px var(--error-color, #db4437)); }
    100% { filter: none; }
  }
  .spin { transform-box: fill-box; transform-origin: 50% 50%; animation: rc-spin 1s linear infinite; }
  @keyframes rc-spin { to { transform: rotate(360deg); } }
  .steam { animation: rc-steam 3s ease-in-out infinite; }
  .steam.b { animation-delay: -1.5s; }
  @keyframes rc-steam { 0% { transform: translateY(4px); opacity: 0; } 40% { opacity: .8; } 100% { transform: translateY(-8px); opacity: 0; } }
  .heat { animation: rc-heat 2.4s ease-in-out infinite; }
  @keyframes rc-heat { 50% { opacity: .35; } }
  .air { animation: rc-air 1.4s linear infinite; }
  .air.b { animation-delay: -.7s; }
  @keyframes rc-air { 0% { transform: translateY(6px); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateY(-4px); opacity: 0; } }
  .water { stroke-dasharray: 3 5; animation: rc-water .5s linear infinite; }
  .water.b { animation-duration: .42s; }
  @keyframes rc-water { to { stroke-dashoffset: -8; } }
  @media (prefers-reduced-motion: reduce) {
    .spin, .steam, .heat, .air, .water, .failed { animation: none; }
    .room, .hit { transition: none; }
  }

  dialog {
    border: none; padding: 0; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 64px); box-sizing: border-box;
    border-radius: var(--ha-card-border-radius, 12px); background: var(--card-background-color, #fff); color: var(--primary-text-color);
    box-shadow: 0 8px 32px rgba(0,0,0,.35); overflow: auto;
  }
  dialog::backdrop { background: rgba(0,0,0,.45); }
  .dh { display: flex; align-items: center; gap: 8px; padding: 12px 8px 4px 16px; }
  .dh .t { flex: 1; font-size: 18px; font-weight: 500; }
  .dh button { background: none; color: var(--secondary-text-color); width: 36px; height: 36px; }
  .ds { padding: 0 8px 12px; }
  .ds h3 { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); margin: 12px 8px 2px; }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; min-height: 36px; padding: 0 8px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .row:hover { background: var(--secondary-background-color, rgba(127,127,127,.1)); }
  .row span:first-child { color: var(--secondary-text-color); }
  .row span:last-child { color: var(--primary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
  .row .on { color: var(--amber-color, #ffc107); font-weight: 500; }
  .row .warn { color: var(--rc-warn); font-weight: 500; }
  .row .blue { color: var(--blue-color, #2196f3); font-weight: 500; }
  .note { font-size: 12px; color: var(--secondary-text-color); padding: 0 16px 12px; }
`;

/* Drawing colours. The house keeps its own colours in light and dark themes, like the sister cards. */
const RC_INK = { lit: "#111", nightOff: "#3d3d3d", dayOff: "#111" };

class RoomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._uid = `rc${++rcUid}`;
    this._opt = new Map(); // entityId -> { target, lastChanged, timer, act }
    this._failed = new Map(); // act -> timer
    this._seen = Object.create(null);
    this._sceneKey = null;
    this._detail = null;
  }

  setConfig(config) {
    this._config = rcNormalize(config);
    this._ids = rcEntityIds(this._config);
    this._seen = Object.create(null);
    this._clearAll();
    this._sceneKey = null;
    this._numFmt = null;
    this._build();
    for (const [v] of Object.values(RC_COLORS)) this.style.removeProperty(v);
    for (const [v, val] of Object.entries(this._config.colors)) this.style.setProperty(v, val);
    if (this._hass) { const h = this._hass; this._hass = null; this.hass = h; }
  }

  static getConfigElement() { return document.createElement("room-card-editor"); }
  static getStubConfig() { return {}; }
  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, rows: 7, min_columns: 6, min_rows: 6 }; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    let changed = first;
    for (const id of this._ids) {
      const s = hass.states[id];
      if (s !== this._seen[id]) {
        this._seen[id] = s;
        this._settle(id, s);
        changed = true;
      }
    }
    if (changed) this._update();
  }

  get hass() { return this._hass; }

  disconnectedCallback() { this._clearAll(); }

  _clearAll() {
    for (const o of this._opt.values()) clearTimeout(o.timer);
    this._opt.clear();
    for (const t of this._failed.values()) clearTimeout(t);
    this._failed.clear();
  }

  /* ---- state helpers ---------------------------------------------------- */

  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
  _unavail(id) { const s = this._st(id); return !s || RC_BAD.includes(String(s.state)); }
  _disp(id) { const o = this._opt.get(id); if (o) return o.target; const s = this._st(id); return s ? s.state : undefined; }
  _on(id) { return !!id && !this._unavail(id) && this._disp(id) === "on"; }
  _open(id) { const s = this._st(id); return !!s && s.state === "on"; }
  _num(id) { const s = this._st(id); return s ? rcNum(s.state) : null; }

  _fmt(n) {
    if (n === null) return "–";
    if (!this._numFmt) {
      const lang = (this._hass.locale && this._hass.locale.language) || this._hass.language || "en";
      try { this._numFmt = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
      catch (_) { this._numFmt = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
    }
    return this._numFmt.format(n);
  }

  _night() {
    const c = this._config;
    const id = c.entities.dark;
    const s = this._st(id);
    if (s && !RC_BAD.includes(String(s.state))) {
      const d = rcDomain(id);
      if (d === "binary_sensor" || d === "input_boolean") return s.state === "on";
      const n = rcNum(s.state);
      if (n !== null) return n < c.dark_below;
    }
    const sun = this._st(c.entities.sun);
    return !!sun && sun.state === "below_horizon";
  }

  _heating(id) {
    const s = this._st(id);
    return !!s && s.attributes && s.attributes.hvac_action === "heating";
  }

  /* ---- what each part of the drawing does ------------------------------- */

  _act(key) {
    const c = this._config;
    if (RC_SLOTS.includes(key)) {
      const light = c.rooms[key].light;
      return { entity: light, tap: light ? "toggle" : "details", hold: "details", slot: key };
    }
    const map = {
      fan_first_3: c.rooms.first_3.fan, fan_first_4: c.rooms.first_4.fan,
      bed_first_1: c.rooms.first_1.bed_light, bed_attic_left: c.rooms.attic_left.bed_light,
      lantern: c.entities.lantern, kitchen: c.entities.kitchen_light, shower: c.rooms.first_4.shower,
    };
    const entity = map[key] || null;
    if (!entity) return { entity: null, tap: "none", hold: "none" };
    const toggle = RC_TOGGLE.has(rcDomain(entity)) && key !== "shower";
    return { entity, tap: toggle ? "toggle" : "more-info", hold: "more-info" };
  }

  _tap(key) {
    const a = this._act(key);
    if (a.tap === "toggle") this._toggle(a.entity, key);
    else if (a.tap === "more-info") this._moreInfo(a.entity);
    else if (a.tap === "details") this._openDetails(a.slot);
  }

  _hold(key) {
    const a = this._act(key);
    if (a.hold === "details") this._openDetails(a.slot);
    else if (a.hold === "more-info") this._moreInfo(a.entity);
  }

  /* ---- optimistic toggles ------------------------------------------------ */

  _settle(id, s) {
    const o = this._opt.get(id);
    if (!o) return;
    if (s && s.state === o.target) this._clearOpt(id);
    else if (!s || s.last_changed !== o.lastChanged) { this._clearOpt(id); this._fail(o.act); }
  }

  _clearOpt(id) { const o = this._opt.get(id); if (!o) return; clearTimeout(o.timer); this._opt.delete(id); }

  _setOpt(id, target, act) {
    this._clearOpt(id);
    const s = this._st(id);
    const timer = setTimeout(() => { this._opt.delete(id); this._fail(act); this._update(); }, RC_ROLLBACK_MS);
    this._opt.set(id, { target, lastChanged: s ? s.last_changed : null, timer, act });
  }

  _fail(act) {
    this._haptic("failure");
    if (!act) return;
    clearTimeout(this._failed.get(act));
    this._failed.set(act, setTimeout(() => { this._failed.delete(act); this._update(); }, RC_FAIL_MS));
    this._sceneKey = null; // restart the flash
    this._update();
  }

  /* Explicit turn_on / turn_off for what the user sees, never a blind toggle. */
  _toggle(id, act) {
    if (!id) return;
    if (this._unavail(id)) { this._fail(act); return; }
    this._haptic("light");
    const target = this._on(id) ? "off" : "on";
    this._setOpt(id, target, act);
    this._update();
    this._call(target === "on" ? "turn_on" : "turn_off", [id], act);
  }

  _allOff() {
    const ids = this._lightIds().filter((id) => this._on(id));
    if (!ids.length) return;
    this._haptic("light");
    for (const id of ids) this._setOpt(id, "off", this._actFor(id));
    this._update();
    this._call("turn_off", ids, null);
  }

  _actFor(id) {
    const c = this._config;
    for (const slot of RC_SLOTS) if (c.rooms[slot].light === id) return slot;
    if (c.rooms.first_1.bed_light === id) return "bed_first_1";
    if (c.rooms.attic_left.bed_light === id) return "bed_attic_left";
    return null;
  }

  _call(service, ids, act) {
    let p;
    try { p = this._hass.callService("homeassistant", service, { entity_id: ids.length === 1 ? ids[0] : ids }); }
    catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).catch((err) => {
      for (const id of ids) this._clearOpt(id);
      this._fail(act);
      this._fire("hass-notification", { message: `homeassistant.${service} failed for ${ids.join(", ")}: ${(err && err.message) || err}` });
    });
  }

  _moreInfo(id) {
    if (!id) return;
    this._haptic("medium");
    this._fire("hass-more-info", { entityId: id });
  }

  _fire(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }
  _haptic(type) { window.dispatchEvent(new CustomEvent("haptic", { detail: type })); }

  /* Room lights and bed lights: what "lights on" counts and All off switches off. */
  _lightIds() {
    const r = this._config.rooms;
    return [...RC_SLOTS.map((s) => r[s].light), r.first_1.bed_light, r.attic_left.bed_light].filter(Boolean);
  }

  /* ---- DOM, built once per config --------------------------------------- */

  _build() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${RC_STYLE}</style>
      <ha-card>
        <div class="head">
          <div class="txt"><div class="name"></div><div class="big"></div><div class="line"></div></div>
          <button class="alloff" aria-label="All lights off" title="All lights off"><ha-icon icon="mdi:lightbulb-group-off"></ha-icon></button>
        </div>
        <div class="pic"></div>
      </ha-card>
      <dialog><div class="dh"><div class="t"></div><button class="x" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="ds"></div><div class="note">Tap a row for more-info.</div></dialog>`;
    this._els = {
      name: root.querySelector(".name"), big: root.querySelector(".big"), line: root.querySelector(".line"),
      alloff: root.querySelector(".alloff"), pic: root.querySelector(".pic"),
      dialog: root.querySelector("dialog"), dt: root.querySelector(".dh .t"), ds: root.querySelector(".ds"),
    };
    this._els.alloff.addEventListener("click", () => this._allOff());
    this._els.dialog.querySelector(".x").addEventListener("click", () => this._closeDetails());
    this._els.dialog.addEventListener("close", () => { this._detail = null; });
    this._els.dialog.addEventListener("click", (e) => {
      if (e.target === this._els.dialog) { this._closeDetails(); return; }
      const row = e.target.closest && e.target.closest(".row");
      if (row && row.dataset.entity) this._moreInfo(row.dataset.entity);
    });
    this._bindPress(this._els.pic);
  }

  /*
   * Tap on release, hold after RC_HOLD_MS, on whichever part of the drawing
   * was pressed. Moving more than a few pixels (scrolling) cancels both.
   * Enter/Space tap, Shift+Enter or the context-menu key hold.
   */
  _bindPress(el) {
    let start = null, timer = null, held = false, target = null;
    const cancel = () => {
      clearTimeout(timer); timer = null; start = null;
      if (target) target.classList.remove("pressed");
      target = null;
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t) return;
      target = t; held = false; start = { x: e.clientX, y: e.clientY };
      t.classList.add("pressed");
      timer = setTimeout(() => { timer = null; held = true; t.classList.remove("pressed"); this._hold(t.dataset.act); }, RC_HOLD_MS);
    });
    el.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > RC_MOVE_PX) cancel();
    });
    el.addEventListener("pointerup", () => {
      if (!start) return;
      const t = target, wasHeld = held;
      cancel();
      if (!wasHeld && t) this._tap(t.dataset.act);
    });
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("keydown", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!t) return;
      if ((e.key === "Enter" && e.shiftKey) || e.key === "ContextMenu") { e.preventDefault(); this._hold(t.dataset.act); return; }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      this._tap(t.dataset.act);
    });
  }

  /* ---- updates ------------------------------------------------------------ */

  _update() {
    if (!this._hass || !this._els) return;
    const c = this._config;
    const R = c.rooms;
    const night = this._night();

    // header
    const lit = this._lightIds().filter((id) => this._on(id)).length;
    const warns = [];
    const notices = [];
    if (this._open(c.entities.front_door)) warns.push("Front door open");
    if (this._open(c.entities.garden_door)) warns.push("Garden doors open");
    if (this._open(c.entities.kitchen_door)) warns.push("Kitchen door open");
    if (this._open(R.ground_right.window)) warns.push(`${R.ground_right.short_name} window open`);
    for (const slot of RC_SLOTS) {
      const id = R[slot].light;
      if (id && this._unavail(id)) notices.push(`${R[slot].short_name} light unavailable`);
    }
    const all = [...warns, ...notices];
    const nameText = all.length ? all[0] + (all.length > 1 ? ` +${all.length - 1}` : "") : c.name;
    this._setText(this._els.name, nameText);
    this._els.name.classList.toggle("warn", warns.length > 0);
    this._els.name.classList.toggle("notice", !warns.length && notices.length > 0);
    const bigHtml = lit ? `${lit}<small>${lit === 1 ? "light on" : "lights on"}</small>` : "All off";
    if (this._els.big.innerHTML !== bigHtml) this._els.big.innerHTML = bigHtml;
    this._els.big.classList.toggle("word", !lit);
    this._setText(this._els.line, this._statusLine());
    this._els.alloff.disabled = !lit;

    // drawing
    const v = this._sceneValues(night);
    const key = JSON.stringify(v);
    if (key !== this._sceneKey) {
      this._sceneKey = key;
      const focused = this.shadowRoot.activeElement && this.shadowRoot.activeElement.dataset
        ? this.shadowRoot.activeElement.dataset.act : null;
      this._els.pic.innerHTML = `<svg viewBox="0 -16 376 344" role="group" aria-label="${rcEsc(c.name)}: tap a room to switch its light, hold for details">${rcScene(v)}</svg>`;
      if (focused) {
        const el = this._els.pic.querySelector(`[data-act="${focused}"]`);
        if (el && el.focus) el.focus();
      }
    }
    if (this._detail) this._renderDetails();
  }

  _setText(el, t) { if (el.textContent !== t) el.textContent = t; }

  _statusLine() {
    const R = this._config.rooms;
    const parts = [];
    const first_4 = R.first_4;
    if (this._on(first_4.shower) || this._open(first_4.shower)) parts.push("Shower running");
    const hum = this._num(first_4.humidity);
    if (hum !== null && hum >= this._config.humidity_alert) {
      parts.push(`${first_4.short_name} ${Math.round(hum)} %${this._on(first_4.fan) ? ", fan on" : ""}`);
    }
    const heating = RC_SLOTS.filter((s) => R[s].climate && this._heating(R[s].climate));
    if (heating.length === 1) {
      const s = this._st(R[heating[0]].climate);
      const t = rcNum(s.attributes.temperature);
      parts.push(`${R[heating[0]].short_name} heating${t !== null ? ` to ${this._fmt(t)}°` : ""}`);
    } else if (heating.length > 1) {
      parts.push(`Heating ${heating.map((s) => R[s].short_name).join(", ")}`);
    }
    if (!parts.length) {
      const temps = RC_SLOTS.map((s) => this._num(R[s].temperature)).filter((n) => n !== null);
      if (temps.length) parts.push(`Inside ${this._fmt(temps.reduce((a, b) => a + b, 0) / temps.length)}° on average`);
    }
    return parts.join(" · ");
  }

  _sceneValues(night) {
    const c = this._config;
    const R = c.rooms;
    const u = this._uid;
    const offFill = night ? "#1a1a1a" : `url(#${u}-day)`;
    const v = {
      uid: u, fill: {}, ink: {}, txt: {}, txt2: {}, temp: {}, label: {}, aria: {}, cls: {},
      o: {}, fanColor: {}, spin: {}, spotColor: {}, sideGlass: {},
    };
    for (const slot of RC_SLOTS) {
      const r = R[slot];
      const on = this._on(r.light);
      v.fill[slot] = on ? `url(#${u}-lit)` : offFill;
      v.ink[slot] = on ? RC_INK.lit : (night ? RC_INK.nightOff : RC_INK.dayOff);
      v.txt[slot] = on ? "#111" : (night ? "#e1e1e1" : "#111");
      v.txt2[slot] = on ? "#6b4e00" : (night ? "#9b9b9b" : "#4a4a4a");
      const t = this._num(r.temperature);
      v.temp[slot] = r.temperature ? `${this._fmt(t)}°` : "";
      v.label[slot] = rcEsc(r.short_name);
      v.aria[slot] = rcEsc(`${r.name}${t !== null ? `, ${this._fmt(t)} degrees` : ""}${r.light ? `, light ${on ? "on" : "off"}` : ""}`);
      v.cls[slot] = [r.light && this._unavail(r.light) ? "unavail" : "", this._failed.has(slot) ? "failed" : ""].join(" ").trim();
    }
    for (const key of ["fan_first_3", "fan_first_4", "bed_first_1", "bed_attic_left", "lantern", "kitchen", "shower"]) {
      const a = this._act(key);
      v.cls[key] = [!a.entity ? "na" : "", a.entity && this._unavail(a.entity) ? "unavail" : "", this._failed.has(key) ? "failed" : ""].join(" ").trim();
    }
    const fan_first_3 = this._on(R.first_3.fan);
    const fan_first_4 = this._on(R.first_4.fan);
    v.fanColor.fan_first_3 = fan_first_3 ? "#81c784" : "#f4f2ee";
    v.fanColor.fan_first_4 = fan_first_4 ? "#90caf9" : "#f4f2ee";
    v.spin.fan_first_3 = fan_first_3 && !rcReduced() ? "spin" : "";
    v.spotColor.first_1 = this._on(R.first_1.bed_light) ? "#ffe082" : "#f4f2ee";
    v.spotColor.attic_left = this._on(R.attic_left.bed_light) ? "#ffe082" : "#f4f2ee";

    const hum = this._num(R.first_4.humidity);
    const humid = hum !== null && hum >= c.humidity_alert;
    const shower = this._on(R.first_4.shower) || this._open(R.first_4.shower);
    const bathLit = this._on(R.first_4.light);
    v.o.steam = humid || shower ? 1 : 0;
    v.o.shower = shower ? 1 : 0;
    v.o.air = fan_first_4 ? 1 : 0;
    v.humText = humid ? `${Math.round(hum)} %` : "";
    v.humColor = bathLit ? "#0d47a1" : (night ? "#64b5f6" : "#1565c0");
    v.steamColor = bathLit ? "#ffffff" : "#9ec9f0";
    v.waterColor = bathLit ? "#1565c0" : "#90caf9";
    v.airColor = "#42a5f5";

    const heat = !!R.ground_right.climate && this._heating(R.ground_right.climate);
    v.o.heat = heat ? 1 : 0;
    v.radFill = heat ? "#ffb27a" : "#f4f2ee";

    const glass = night ? "#14181c" : `url(#${u}-day)`;
    v.winGlass = glass;
    v.sideGlass.first_3 = night && this._on(R.first_3.light) ? "#ffc552" : glass;
    v.sideGlass.ground_right = night && this._on(R.ground_right.light) ? "#ffc552" : glass;
    v.sideGlass.first_4 = night ? (bathLit ? "#ffe7a8" : "#2c3237") : "#dfe4e7";

    const kitchenOn = this._on(c.entities.kitchen_light);
    v.o.kitchenDim = night ? (kitchenOn ? 0 : 0.8) : 0;
    v.o.kitchenWarm = night && kitchenOn ? 0.22 : 0;
    v.kitchenGlass = night ? (kitchenOn ? "#ffc552" : "#14181c") : `url(#${u}-day)`;
    v.lanternGlass = this._on(c.entities.lantern) ? "#ffd54f" : "#3a3a3a";
    v.hemColor = "#ff9800";
    return v;
  }

  /* ---- details pop-up ----------------------------------------------------- */

  _openDetails(slot) {
    if (!slot) return;
    this._haptic("medium");
    this._detail = slot;
    this._renderDetails();
    const d = this._els.dialog;
    if (!d.open) {
      if (typeof d.showModal === "function") { try { d.showModal(); } catch (_) { d.setAttribute("open", ""); } }
      else d.setAttribute("open", "");
    }
  }

  _closeDetails() {
    const d = this._els.dialog;
    this._detail = null;
    if (typeof d.close === "function" && d.open) d.close();
    else d.removeAttribute("open");
  }

  _renderDetails() {
    const c = this._config;
    const r = c.rooms[this._detail];
    const row = (label, id, value, cls) => (id ? `<div class="row" data-entity="${rcEsc(id)}" role="button" tabindex="0"><span>${rcEsc(label)}</span><span class="${cls || ""}">${rcEsc(value)}</span></div>` : "");
    const val = (id, fmt) => (this._unavail(id) ? "Unavailable" : fmt(this._st(id)));
    const onOff = (id) => val(id, () => (this._on(id) ? "On" : "Off"));
    const openClosed = (id) => val(id, (s) => (s.state === "on" ? "Open" : "Closed"));
    const unit = (id, def) => { const s = this._st(id); return (s && s.attributes.unit_of_measurement) || def; };
    const sections = [];
    const climate = [
      row("Temperature", r.temperature, val(r.temperature, (s) => `${this._fmt(rcNum(s.state))} ${unit(r.temperature, "°C")}`)),
      row("Humidity", r.humidity, val(r.humidity, (s) => `${Math.round(rcNum(s.state))} %`),
        this._detail === "first_4" && this._num(r.humidity) !== null && this._num(r.humidity) >= c.humidity_alert ? "blue" : ""),
      row("Thermostat", r.climate, val(r.climate, (s) => {
        const t = rcNum(s.attributes.temperature);
        if (s.state === "off") return "Off";
        if (s.attributes.hvac_action === "heating") return `Heating to ${this._fmt(t)} °C`;
        return t !== null ? `Idle · ${this._fmt(t)} °C` : "Idle";
      }), r.climate && this._heating(r.climate) ? "on" : ""),
    ].join("");
    if (climate) sections.push(`<h3>Climate</h3>${climate}`);
    const ctl = [
      row("Light", r.light, onOff(r.light), this._on(r.light) ? "on" : ""),
      row("Fan", r.fan, onOff(r.fan), this._on(r.fan) ? "blue" : ""),
      row("Bed light", r.bed_light, onOff(r.bed_light), this._on(r.bed_light) ? "on" : ""),
      row("Shower", r.shower, val(r.shower, (s) => (s.state === "on" ? "Running" : "Off")), this._open(r.shower) ? "blue" : ""),
    ];
    if (this._detail === "ground_right") {
      ctl.push(row("Kitchen light", c.entities.kitchen_light, onOff(c.entities.kitchen_light), this._on(c.entities.kitchen_light) ? "on" : ""));
      ctl.push(row("Garden lantern", c.entities.lantern, onOff(c.entities.lantern), this._on(c.entities.lantern) ? "on" : ""));
    }
    if (ctl.join("")) sections.push(`<h3>Controls</h3>${ctl.join("")}`);
    const sens = [
      row("Door", r.door, openClosed(r.door), this._open(r.door) ? "warn" : ""),
      row("Window", r.window, openClosed(r.window), this._open(r.window) ? "warn" : ""),
      row("Motion", r.occupancy, val(r.occupancy, (s) => (s.state === "on" ? "Detected" : "Clear"))),
    ];
    if (this._detail === "ground_left") sens.push(row("Front door", c.entities.front_door, openClosed(c.entities.front_door), this._open(c.entities.front_door) ? "warn" : ""));
    if (this._detail === "ground_right") {
      sens.push(row("Garden doors", c.entities.garden_door, openClosed(c.entities.garden_door), this._open(c.entities.garden_door) ? "warn" : ""));
      sens.push(row("Kitchen door", c.entities.kitchen_door, openClosed(c.entities.kitchen_door), this._open(c.entities.kitchen_door) ? "warn" : ""));
    }
    if (sens.join("")) sections.push(`<h3>Doors and sensors</h3>${sens.join("")}`);
    const html = sections.join("") || '<div class="note">Nothing configured for this room.</div>';
    this._setText(this._els.dt, r.name);
    if (this._els.ds.innerHTML !== html) this._els.ds.innerHTML = html;
  }
}

/* ------------------------------------------------------------------------ */
/* Visual editor                                                            */
/* ------------------------------------------------------------------------ */

/*
 * Built on HA's own <ha-form>. Fields show the defaults (the owner's own
 * entities); only values that differ from the defaults are written. A cleared
 * default is written as null, which switches it off.
 */

const RC_ROLE_DOMAINS = {
  temperature: ["sensor"], humidity: ["sensor"], climate: ["climate"],
  light: ["light", "switch", "input_boolean"], bed_light: ["light", "switch", "input_boolean"], fan: ["fan", "switch", "input_boolean"],
  shower: ["binary_sensor", "input_boolean", "switch"], door: ["binary_sensor"], window: ["binary_sensor"], occupancy: ["binary_sensor"],
  dark: ["sensor", "binary_sensor", "input_boolean"], sun: ["sun"], lantern: ["light", "switch"], kitchen_light: ["light", "switch"],
  front_door: ["binary_sensor"], garden_door: ["binary_sensor"], kitchen_door: ["binary_sensor"],
};
const rcEntitySel = (role) => ({ entity: RC_ROLE_DOMAINS[role] ? { filter: { domain: RC_ROLE_DOMAINS[role] } } : {} });
const RC_ROOM_ICONS = { attic_left: "mdi:bed", attic_right: "mdi:bike-fast", first_1: "mdi:bed", first_2: "mdi:desk", first_3: "mdi:bed-king", first_4: "mdi:shower", ground_left: "mdi:coat-rack", ground_right: "mdi:sofa" };

const RC_EDITOR_SCHEMA = [
  { name: "name", selector: { text: {} } },
  {
    type: "grid", name: "", schema: [
      { name: "humidity_alert", selector: { number: { min: 40, max: 100, step: 5, mode: "box", unit_of_measurement: "%" } } },
      { name: "dark_below", selector: { number: { min: 0, max: 1000, step: 1, mode: "box", unit_of_measurement: "lx" } } },
    ],
  },
  { type: "expandable", name: "entities", title: "House and garden", icon: "mdi:home", schema: Object.keys(RC_DEFAULTS.entities).map((k) => ({ name: k, selector: rcEntitySel(k) })) },
  ...RC_SLOTS.map((slot) => ({
    type: "expandable", name: `room_${slot}`, title: `${RC_DEFAULTS.rooms[slot].name} (${RC_FLOORS[slot].toLowerCase()})`, icon: RC_ROOM_ICONS[slot],
    schema: [
      { type: "grid", name: "", schema: RC_ROOM_TEXT.map((t) => ({ name: t, selector: { text: {} } })) },
      ...[...RC_COMMON_ROLES, ...RC_ROOM_ROLES[slot]].map((role) => ({ name: role, selector: rcEntitySel(role) })),
    ],
  })),
];

const RC_EDITOR_LABELS = {
  name: "Card name", short_name: "Name in the drawing", humidity_alert: "Bathroom humidity alert", dark_below: "Dark below",
  dark: "Dark sensor (empty: the sun)", sun: "Sun", lantern: "Garden lantern", kitchen_light: "Kitchen light",
  front_door: "Front door", garden_door: "Garden doors", kitchen_door: "Kitchen door",
  temperature: "Temperature", humidity: "Humidity", light: "Light (tap the room)", climate: "Thermostat",
  bed_light: "Bed light", fan: "Fan", shower: "Shower running", door: "Door", window: "Window", occupancy: "Motion",
};

class RoomCardEditor extends HTMLElement {
  /* config -> form data: the effective values, defaults included. */
  static toData(config) {
    let n;
    try { n = rcNormalize(config || {}); } catch (_) { n = rcNormalize({}); }
    const data = { name: n.name, humidity_alert: n.humidity_alert, dark_below: n.dark_below, entities: {} };
    for (const [k, val] of Object.entries(n.entities)) data.entities[k] = val || "";
    for (const slot of RC_SLOTS) {
      const r = n.rooms[slot];
      const d = {};
      for (const [k, val] of Object.entries(r)) if (k !== "slot") d[k] = val || "";
      data[`room_${slot}`] = d;
    }
    return data;
  }

  /* form data -> config: only differences from the defaults. Unknown keys are kept. */
  static toConfig(data, previous) {
    const config = { type: "custom:room-card" };
    const known = ["name", "humidity_alert", "dark_below", "entities", "rooms"];
    for (const [k, val] of Object.entries(previous || {})) if (k !== "type" && !known.includes(k)) config[k] = val;
    if (data.name !== undefined && data.name !== RC_DEFAULTS.name) config.name = data.name;
    for (const k of ["humidity_alert", "dark_below"]) {
      const val = rcNum(data[k]);
      if (val !== null && val !== RC_DEFAULTS[k]) config[k] = val;
    }
    const ents = {};
    for (const k of Object.keys(RC_DEFAULTS.entities)) {
      const val = (data.entities && data.entities[k]) || null;
      if (val !== RC_DEFAULTS.entities[k]) ents[k] = val;
    }
    if (Object.keys(ents).length) config.entities = ents;
    const rooms = {};
    for (const slot of RC_SLOTS) {
      const def = RC_DEFAULTS.rooms[slot];
      const d = data[`room_${slot}`] || {};
      const out = {};
      for (const t of RC_ROOM_TEXT) if (d[t] && d[t] !== def[t]) out[t] = d[t];
      for (const role of [...RC_COMMON_ROLES, ...RC_ROOM_ROLES[slot]]) {
        const val = d[role] || null;
        const dv = def[role] === undefined ? null : def[role];
        if (val !== dv) out[role] = val;
      }
      if (Object.keys(out).length) rooms[slot] = out;
    }
    if (Object.keys(rooms).length) config.rooms = rooms;
    return config;
  }

  setConfig(config) { this._config = config; this._render(); }
  set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; }
  connectedCallback() { this._ensureForm().then(() => this._render()); }

  /* ha-form is lazy loaded by HA; make sure it exists before using it. */
  async _ensureForm() {
    if (customElements.get("ha-form")) return;
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "entities", entities: [] });
      if (card.constructor.getConfigElement) await card.constructor.getConfigElement();
    } catch (_) { /* the form renders once HA has loaded it */ }
    await customElements.whenDefined("ha-form");
  }

  _render() {
    if (!this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = RC_EDITOR_SCHEMA;
      this._form.computeLabel = (s) => RC_EDITOR_LABELS[s.name] || s.name.replace(/_/g, " ");
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        const config = RoomCardEditor.toConfig(e.detail.value, this._config);
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = RoomCardEditor.toData(this._config);
  }
}

/* ------------------------------------------------------------------------ */
/* Registration                                                             */
/* ------------------------------------------------------------------------ */

if (!customElements.get("room-card")) customElements.define("room-card", RoomCard);
if (!customElements.get("room-card-editor")) customElements.define("room-card-editor", RoomCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "room-card")) {
  window.customCards.push({
    type: "room-card",
    name: "Room Card",
    description: "The whole house in one card: a cut-away drawing with every room's light, temperature, fans and doors.",
    preview: true,
    documentationURL: "https://github.com/BarBaar44/room-card",
  });
}

console.info(
  `%c ROOM-CARD %c v${VERSION} `,
  "color:#fff;background:#ff9800;font-weight:700;border-radius:3px 0 0 3px",
  "color:#ff9800;background:#fff;font-weight:700;border-radius:0 3px 3px 0"
);
}
