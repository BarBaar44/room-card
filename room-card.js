/*! room-card | MIT | https://github.com/BarBaar44/room-card */
/*
 * Lightweight Lovelace room tile for Home Assistant.
 * Single file, no build step, no dependencies, no card_mod, no Jinja.
 *
 * Structure:
 *   RoomCardBase  shared plumbing (hass diffing, optimistic state, tap/hold,
 *                 ripple, haptics, colours). A future `custom:device-button`
 *                 extends this same base.
 *   RoomCard      the room tile itself.
 */

const VERSION = "0.1.1";

const HOLD_MS = 500;
const FAIL_FLASH_MS = 1200;
const ROLLBACK_MS = 5000;
const MOVE_TOLERANCE_PX = 10;
const MAX_CHIPS = 3;

/* HA theme colour names. Fallbacks are HA's own defaults. */
const NAMED_COLORS = {
  primary: "var(--primary-color)",
  accent: "var(--accent-color)",
  red: "var(--red-color, #f44336)",
  pink: "var(--pink-color, #e91e63)",
  purple: "var(--purple-color, #926bc7)",
  "deep-purple": "var(--deep-purple-color, #6e41ab)",
  indigo: "var(--indigo-color, #3f51b5)",
  blue: "var(--blue-color, #2196f3)",
  "light-blue": "var(--light-blue-color, #03a9f4)",
  cyan: "var(--cyan-color, #00bcd4)",
  teal: "var(--teal-color, #009688)",
  green: "var(--green-color, #4caf50)",
  "light-green": "var(--light-green-color, #8bc34a)",
  lime: "var(--lime-color, #cddc39)",
  yellow: "var(--yellow-color, #ffeb3b)",
  amber: "var(--amber-color, #ffc107)",
  orange: "var(--orange-color, #ff9800)",
  "deep-orange": "var(--deep-orange-color, #ff6f22)",
  brown: "var(--brown-color, #795548)",
  grey: "var(--grey-color, #9e9e9e)",
  "blue-grey": "var(--blue-grey-color, #607d8b)",
  white: "var(--white-color, #ffffff)",
  black: "var(--black-color, #000000)",
};

/* Domains that get on/off with optimistic feedback. */
const TOGGLE_DOMAINS = new Set(["switch", "light", "fan", "input_boolean"]);
/* Domains that are fired, not toggled. State is not optimistic for these. */
const ACTIVATE_DOMAINS = new Set(["scene", "script"]);
/* Domains whose normal state can be "unknown" without being broken. */
const STATELESS_DOMAINS = new Set(["scene", "script", "button", "input_button"]);
/* States that count as "active" for colouring. */
const ACTIVE_STATES = new Set([
  "on", "open", "opening", "closing", "playing", "home", "unlocked", "cleaning", "active",
]);

const TAP_ACTIONS = ["toggle", "more-info", "none"];
const HOLD_ACTIONS = ["more-info", "none"];
const BRIGHTNESS_MODES = ["percent", "none"];

const DOMAIN_ICONS = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch-variant",
  fan: "mdi:fan",
  input_boolean: "mdi:toggle-switch-outline",
  scene: "mdi:palette",
  script: "mdi:script-text",
  sensor: "mdi:eye",
  binary_sensor: "mdi:checkbox-blank-circle-outline",
};
const BINARY_ICONS = {
  door: ["mdi:door-closed", "mdi:door-open"],
  garage_door: ["mdi:garage", "mdi:garage-open"],
  window: ["mdi:window-closed", "mdi:window-open"],
  opening: ["mdi:square-outline", "mdi:square"],
  motion: ["mdi:motion-sensor-off", "mdi:motion-sensor"],
  occupancy: ["mdi:home-outline", "mdi:home"],
  moisture: ["mdi:water-off", "mdi:water"],
};

const domainOf = (entityId) => entityId.split(".", 1)[0];
const isEntityId = (v) => typeof v === "string" && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v);
const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function isValidColor(c) {
  if (c === "auto" || NAMED_COLORS[c]) return true;
  if (typeof c !== "string" || !c) return false;
  if (window.CSS && typeof CSS.supports === "function") return CSS.supports("color", c);
  return true;
}

function resolveColor(c, fallback) {
  if (!c) return NAMED_COLORS[fallback] || fallback;
  return NAMED_COLORS[c] || c;
}

/* ------------------------------------------------------------------------ */
/* Shared base                                                              */
/* ------------------------------------------------------------------------ */

class RoomCardBase extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._entityIds = [];
    this._seen = Object.create(null);
    this._optimistic = new Map(); // entityId -> { target, lastChanged, timer }
    this._dirty = true;
  }

  /* Re-render only when one of our own entities changed. */
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    let changed = first || this._dirty;
    const dark = !!(hass.themes && hass.themes.darkMode);
    if (dark !== this._dark) {
      this._dark = dark;
      changed = true;
    }
    for (const id of this._entityIds) {
      const s = hass.states[id];
      if (s !== this._seen[id]) {
        this._seen[id] = s;
        this._settleOptimistic(id, s);
        changed = true;
      }
    }
    if (changed) {
      this._dirty = false;
      this._update();
    }
  }

  get hass() {
    return this._hass;
  }

  disconnectedCallback() {
    for (const o of this._optimistic.values()) clearTimeout(o.timer);
    this._optimistic.clear();
  }

  /* Subclasses implement */
  _update() {}

  /* ---- state helpers ---------------------------------------------------- */

  _stateObj(id) {
    return id && this._hass ? this._hass.states[id] : undefined;
  }

  _isUnavailable(id) {
    const s = this._stateObj(id);
    if (!s) return true;
    if (s.state === "unavailable") return true;
    return s.state === "unknown" && !STATELESS_DOMAINS.has(domainOf(id));
  }

  /* Displayed state: optimistic target if pending, else HA's state. */
  _displayState(id) {
    const o = this._optimistic.get(id);
    if (o) return o.target;
    const s = this._stateObj(id);
    return s ? s.state : undefined;
  }

  _isActive(id) {
    return ACTIVE_STATES.has(this._displayState(id));
  }

  /* ---- optimistic state ------------------------------------------------- */

  /*
   * Confirm when HA reports the target state; roll back when the state
   * changed to something else. Attribute-only updates keep the pending state.
   */
  _settleOptimistic(id, s) {
    const o = this._optimistic.get(id);
    if (!o) return;
    if (s && s.state === o.target) {
      this._clearOptimistic(id); // confirmed
    } else if (!s || s.last_changed !== o.lastChanged) {
      this._clearOptimistic(id); // changed to something else: failed
      this._flagFailure(o.el);
    }
  }

  _clearOptimistic(id) {
    const o = this._optimistic.get(id);
    if (!o) return;
    clearTimeout(o.timer);
    this._optimistic.delete(id);
  }

  _setOptimistic(id, target, el) {
    this._clearOptimistic(id);
    const s = this._stateObj(id);
    const timer = setTimeout(() => {
      this._optimistic.delete(id);
      this._update(); // roll back to whatever HA says
      this._flagFailure(el);
    }, ROLLBACK_MS);
    this._optimistic.set(id, { target, lastChanged: s ? s.last_changed : null, timer, el });
  }

  /* Visible and haptic signal that a tap did not take effect. */
  _flagFailure(el) {
    this._haptic("failure");
    if (!el) return;
    clearTimeout(el._rcFailTimer);
    el.classList.remove("failed");
    void el.offsetWidth; // restart animation
    el.classList.add("failed");
    el._rcFailTimer = setTimeout(() => el.classList.remove("failed"), FAIL_FLASH_MS);
  }

  /* ---- actions ---------------------------------------------------------- */

  /*
   * Sends an explicit turn_on/turn_off for what the user sees, not a blind
   * toggle, so two quick taps can never end up out of sync with the screen.
   */
  _toggle(id, el) {
    if (this._isUnavailable(id)) {
      this._haptic("failure");
      return;
    }
    const domain = domainOf(id);
    this._haptic("light");

    if (ACTIVATE_DOMAINS.has(domain)) {
      this._pulse(el);
      this._call(domain, "turn_on", id, el);
      return;
    }
    if (!TOGGLE_DOMAINS.has(domain)) return;

    const target = this._isActive(id) ? "off" : "on";
    this._setOptimistic(id, target, el);
    this._update();
    this._call("homeassistant", target === "on" ? "turn_on" : "turn_off", id, el);
  }

  _call(domain, service, id, el) {
    let p;
    try {
      p = this._hass.callService(domain, service, { entity_id: id });
    } catch (err) {
      p = Promise.reject(err);
    }
    Promise.resolve(p).catch((err) => {
      this._clearOptimistic(id);
      this._update();
      this._flagFailure(el);
      this._fire("hass-notification", {
        message: `${domain}.${service} failed for ${id}: ${(err && err.message) || err}`,
      });
    });
  }

  _moreInfo(id) {
    if (!id) return;
    this._haptic("medium");
    this._fire("hass-more-info", { entityId: id });
  }

  _fire(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /* HA companion app listens for this on window. */
  _haptic(type) {
    window.dispatchEvent(new CustomEvent("haptic", { detail: type }));
  }

  /* ---- press handling --------------------------------------------------- */

  /*
   * Tap on release, hold after HOLD_MS. Moving more than a few pixels
   * (scrolling) cancels both. Enter/Space count as tap.
   */
  _bindPress(el, { tap, hold }) {
    let timer = null;
    let start = null;
    let held = false;

    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      start = null;
      el.classList.remove("pressed");
    };

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      held = false;
      start = { x: e.clientX, y: e.clientY };
      el.classList.add("pressed");
      this._ripple(el, e);
      if (hold) {
        timer = setTimeout(() => {
          timer = null;
          held = true;
          el.classList.remove("pressed");
          hold();
        }, HOLD_MS);
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    });
    el.addEventListener("pointerup", () => {
      if (!start) return;
      const wasHeld = held;
      cancel();
      if (!wasHeld && tap) tap();
    });
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (tap) tap();
    });
  }

  _ripple(el, e) {
    if (reducedMotion()) return;
    const surface = el.querySelector(".surface") || el;
    const rect = surface.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const r = document.createElement("span");
    r.className = "ripple";
    r.style.width = r.style.height = `${size}px`;
    r.style.left = `${(e.clientX || rect.left + rect.width / 2) - rect.left - size / 2}px`;
    r.style.top = `${(e.clientY || rect.top + rect.height / 2) - rect.top - size / 2}px`;
    surface.appendChild(r);
    const done = () => r.remove();
    r.addEventListener("animationend", done, { once: true });
    setTimeout(done, 800);
  }

  _pulse(el) {
    if (!el || reducedMotion()) return;
    el.classList.remove("pulse");
    void el.offsetWidth; // restart animation
    el.classList.add("pulse");
  }
}

/* ------------------------------------------------------------------------ */
/* Room card                                                                */
/* ------------------------------------------------------------------------ */

const ROOM_KEYS = new Set([
  "type", "name", "temperature", "main", "chips", "colors",
  "grid_options", "layout_options", "view_layout", "visibility", "card_mod",
]);
const MAIN_KEYS = new Set(["entity", "icon", "color", "tap", "hold", "brightness"]);
const CHIP_KEYS = new Set(["entity", "icon", "color", "tap", "hold"]);

/* Card level colour overrides: YAML key -> CSS variable. */
const COLOR_VARS = {
  name: "--room-card-name-color",
  temperature: "--room-card-temperature-color",
  icon_off: "--room-card-off-color",
  background_off: "--room-card-off-background",
  background_on: "--room-card-on-background",
  chip_icon_off: "--room-card-chip-off-color",
  chip_background: "--room-card-chip-background",
  chip_outline: "--room-card-chip-outline",
  badge: "--room-card-badge-color",
  badge_icon: "--room-card-badge-icon-color",
  ripple: "--room-card-ripple-color",
  focus: "--room-card-focus-color",
  failure: "--room-card-failure-color",
  card_background: "--ha-card-background",
  card_border: "--ha-card-border-color",
};

function checkKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      throw new Error(`${where}: unknown option '${k}'. Allowed: ${[...allowed].join(", ")}`);
    }
  }
}

function defaultTap(entity) {
  if (!entity) return "none";
  const d = domainOf(entity);
  return TOGGLE_DOMAINS.has(d) || ACTIVATE_DOMAINS.has(d) ? "toggle" : "none";
}

function normalizeButton(raw, where, allowed, defaultColor) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${where} must be a mapping (entity, icon, color, ...)`);
  }
  checkKeys(raw, allowed, where);
  const out = {
    entity: raw.entity || null,
    icon: raw.icon || null,
    color: raw.color || defaultColor,
  };
  if (out.entity !== null && !isEntityId(out.entity)) {
    throw new Error(`${where}.entity: '${raw.entity}' is not a valid entity id`);
  }
  if (out.icon !== null && (typeof out.icon !== "string" || !out.icon.includes(":"))) {
    throw new Error(`${where}.icon: use the form mdi:name`);
  }
  if (!isValidColor(out.color)) {
    throw new Error(
      `${where}.color: '${raw.color}' is not a colour. Use auto, a theme name (${Object.keys(NAMED_COLORS).slice(0, 6).join(", ")}, ...) or any CSS colour`
    );
  }
  out.tap = raw.tap || defaultTap(out.entity);
  if (!TAP_ACTIONS.includes(out.tap)) {
    throw new Error(`${where}.tap: '${raw.tap}' must be one of ${TAP_ACTIONS.join(", ")}`);
  }
  if (out.tap !== "none" && !out.entity) {
    throw new Error(`${where}.tap: '${out.tap}' needs an entity`);
  }
  if (out.tap === "toggle") {
    const d = domainOf(out.entity);
    if (!TOGGLE_DOMAINS.has(d) && !ACTIVATE_DOMAINS.has(d)) {
      throw new Error(
        `${where}.tap: toggle is not possible for ${d}. Use none (status only) or more-info`
      );
    }
  }
  out.hold = raw.hold || (out.entity && out.tap !== "none" ? "more-info" : "none");
  if (!HOLD_ACTIONS.includes(out.hold)) {
    throw new Error(`${where}.hold: '${raw.hold}' must be one of ${HOLD_ACTIONS.join(", ")}`);
  }
  if (out.hold !== "none" && !out.entity) {
    throw new Error(`${where}.hold: '${out.hold}' needs an entity`);
  }
  return out;
}

function validateRoomConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Invalid configuration");
  checkKeys(config, ROOM_KEYS, "room-card");

  if (config.name !== undefined && typeof config.name !== "string") {
    throw new Error("name must be text");
  }
  if (config.temperature !== undefined && !isEntityId(config.temperature)) {
    throw new Error(`temperature: '${config.temperature}' is not a valid entity id`);
  }

  let main = null;
  if (config.main !== undefined && config.main !== null) {
    main = normalizeButton(config.main, "main", MAIN_KEYS, "amber");
    if (!main.entity && !main.icon) throw new Error("main needs an entity, an icon, or both");
    main.brightness = config.main.brightness || "none";
    if (!BRIGHTNESS_MODES.includes(main.brightness)) {
      throw new Error(`main.brightness must be one of ${BRIGHTNESS_MODES.join(", ")}`);
    }
  }

  const rawChips = config.chips === undefined || config.chips === null ? [] : config.chips;
  if (!Array.isArray(rawChips)) throw new Error("chips must be a list");
  if (rawChips.length > MAX_CHIPS) throw new Error(`chips: at most ${MAX_CHIPS} chips`);
  const chips = rawChips.map((c, i) => {
    const chip = normalizeButton(c, `chips[${i}]`, CHIP_KEYS, "amber");
    if (!chip.entity) throw new Error(`chips[${i}].entity is required`);
    return chip;
  });

  if (!main && !chips.length && !config.temperature) {
    throw new Error("room-card needs at least one of: temperature, main, chips");
  }

  const colors = {};
  if (config.colors !== undefined && config.colors !== null) {
    if (typeof config.colors !== "object" || Array.isArray(config.colors)) {
      throw new Error("colors must be a mapping, e.g. colors: { name: white }");
    }
    checkKeys(config.colors, new Set(Object.keys(COLOR_VARS)), "colors");
    for (const [k, v] of Object.entries(config.colors)) {
      if (v === "auto" || !isValidColor(v)) throw new Error(`colors.${k}: '${v}' is not a colour`);
      colors[COLOR_VARS[k]] = resolveColor(v);
    }
  }

  return { name: config.name || "", temperature: config.temperature || null, main, chips, colors };
}

const STYLE = `
  :host { display: block; height: 100%; }
  ha-card {
    position: relative;
    height: 100%;
    min-height: 120px;
    box-sizing: border-box;
    overflow: hidden;
    container-type: size;
  }
  .tile {
    --pad: 8px;
    --circle: var(--room-card-icon-size, 75px);
    --chip-gap: 6px;
    --chip: min(var(--room-card-chip-size, 44px),
                calc((100cqh - 2 * var(--pad) - (var(--chips, 1) - 1) * var(--chip-gap)) / var(--chips, 1)));
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto minmax(0, 1fr);
    column-gap: 8px;
    height: 100%;
    padding: var(--pad) 10px;
    box-sizing: border-box;
  }
  .info { grid-column: 1; grid-row: 1; min-width: 0; padding-left: 2px; }
  .name {
    font-size: 15px; line-height: 18px; font-weight: 600;
    color: var(--room-card-name-color, var(--primary-text-color));
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .temp {
    font-size: 13px; line-height: 16px;
    color: var(--room-card-temperature-color, var(--secondary-text-color));
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  /* Main circle sits in the bottom left corner and bleeds off the card edge. */
  .btn.main {
    position: absolute;
    left: var(--room-card-icon-offset-x, -6px);
    bottom: var(--room-card-icon-offset-y, -16px);
    width: var(--circle); height: var(--circle);
  }
  .main .surface ha-icon { --mdc-icon-size: var(--room-card-icon-inner-size, 45px); }
  .chips {
    grid-column: 2; grid-row: 1 / 3;
    display: flex; flex-direction: column;
    justify-content: var(--room-card-chip-align, flex-start);
    gap: var(--chip-gap);
  }
  .chip { width: var(--chip); height: var(--chip); }
  .chip .surface ha-icon { --mdc-icon-size: calc(var(--chip) * 0.55); }

  .btn {
    position: relative;
    flex: none;
    border-radius: 50%;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    transition: transform 120ms ease;
  }
  .btn.clickable { cursor: pointer; }
  .btn.pressed { transform: scale(0.93); }
  .btn:focus-visible .surface { box-shadow: 0 0 0 2px var(--room-card-focus-color, var(--primary-color)); }
  .surface {
    position: relative;
    width: 100%; height: 100%;
    border-radius: 50%;
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    color: var(--room-card-off-color, var(--secondary-text-color));
    background: var(--room-card-off-background,
                    color-mix(in srgb, var(--secondary-text-color) 12%, transparent));
    transition: background-color 180ms ease, color 180ms ease;
  }
  .btn.on .surface {
    color: var(--c);
    background: var(--room-card-on-background, color-mix(in srgb, var(--c) 22%, transparent));
  }
  .chip .surface { color: var(--room-card-chip-off-color, var(--room-card-off-color, var(--secondary-text-color))); }
  .chip.on .surface { color: var(--c); }
  /* Chips: icon only, no background (override per theme if wanted). */
  .chip .surface, .chip.on .surface { background: var(--room-card-chip-background, transparent); }
  /* Light mode: dark outline so pale colours (yellow) stay visible. */
  .light-mode .chip.on .surface ha-icon {
    filter: drop-shadow(0 0 0.6px var(--room-card-chip-outline, rgba(0, 0, 0, 0.75)))
            drop-shadow(0 0 0.6px var(--room-card-chip-outline, rgba(0, 0, 0, 0.75)));
  }
  .btn.unavail .surface { opacity: 0.4; }
  .badge {
    display: none;
    position: absolute; top: -2px; right: -2px;
    width: 18px; height: 18px; border-radius: 50%;
    align-items: center; justify-content: center;
    background: var(--room-card-badge-color, var(--error-color, #db4437));
    color: var(--room-card-badge-icon-color, #fff);
    --mdc-icon-size: 12px;
    pointer-events: none;
  }
  .chip .badge { width: 14px; height: 14px; --mdc-icon-size: 10px; top: -3px; right: -3px; }
  .btn.unavail .badge { display: flex; }

  .ripple {
    position: absolute;
    border-radius: 50%;
    background: var(--room-card-ripple-color, currentColor);
    opacity: 0.3;
    transform: scale(0);
    pointer-events: none;
    animation: rc-ripple 450ms ease-out forwards;
  }
  @keyframes rc-ripple { to { transform: scale(1); opacity: 0; } }
  .btn.pulse .surface { animation: rc-pulse 600ms ease-out; }
  @keyframes rc-pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c) 60%, transparent); }
    100% { box-shadow: 0 0 0 12px transparent; }
  }

  /* Tap did not take effect: red ring and a short shake. */
  .btn.failed .surface {
    box-shadow: inset 0 0 0 2px var(--room-card-failure-color, var(--error-color, #db4437));
    animation: rc-shake 400ms ease-in-out;
  }
  @keyframes rc-shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-4px); }
    40%, 80% { transform: translateX(4px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .btn, .surface { transition: none; }
    .btn.pressed { transform: none; }
    .btn.pressed .surface { filter: brightness(0.9); }
    .ripple { display: none; }
    .btn.pulse .surface, .btn.failed .surface { animation: none; }
  }
`;

class RoomCard extends RoomCardBase {
  setConfig(config) {
    this._config = validateRoomConfig(config);
    const c = this._config;
    this._entityIds = [c.temperature, c.main && c.main.entity, ...c.chips.map((x) => x.entity)]
      .filter(Boolean);
    this._seen = Object.create(null);
    for (const o of this._optimistic.values()) clearTimeout(o.timer);
    this._optimistic.clear();
    this._numFmt = null;
    for (const v of Object.values(COLOR_VARS)) this.style.removeProperty(v);
    for (const [v, val] of Object.entries(c.colors)) this.style.setProperty(v, val);
    this._build();
    this._dirty = true;
    if (this._hass) this.hass = this._hass;
  }

  static getStubConfig(hass) {
    const ids = Object.keys((hass && hass.states) || {});
    const temp = ids.find(
      (id) => id.startsWith("sensor.") && hass.states[id].attributes.device_class === "temperature"
    );
    const main = ids.find((id) => id.startsWith("light.")) || ids.find((id) => id.startsWith("switch."));
    const stub = { name: "Room" };
    if (temp) stub.temperature = temp;
    stub.main = main ? { entity: main, icon: "mdi:lightbulb" } : { icon: "mdi:sofa" };
    stub.chips = [];
    return stub;
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 6, rows: 2, min_columns: 4, min_rows: 2 };
  }

  /* ---- DOM, built once per config --------------------------------------- */

  _makeButton(cfg, cls) {
    const el = document.createElement("div");
    el.className = `btn ${cls}`;
    el.innerHTML =
      '<div class="surface"><ha-icon></ha-icon></div>' +
      '<span class="badge"><ha-icon icon="mdi:alert"></ha-icon></span>';
    const tap = cfg.tap === "toggle"
      ? () => this._toggle(cfg.entity, el)
      : cfg.tap === "more-info"
        ? () => this._moreInfo(cfg.entity)
        : null;
    const hold = cfg.hold === "more-info" ? () => this._moreInfo(cfg.entity) : null;
    if (tap || hold) {
      el.classList.add("clickable");
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      this._bindPress(el, { tap, hold });
    }
    return { el, cfg, icon: el.querySelector(".surface ha-icon") };
  }

  _build() {
    const c = this._config;
    const root = this.shadowRoot;
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="tile">
          <div class="info"><div class="name"></div><div class="temp"></div></div>
          <div class="chips"></div>
        </div>
      </ha-card>`;
    this._els = {
      tile: root.querySelector(".tile"),
      name: root.querySelector(".name"),
      temp: root.querySelector(".temp"),
      chips: root.querySelector(".chips"),
    };
    this._els.tile.style.setProperty("--chips", String(Math.max(1, c.chips.length)));

    this._main = null;
    if (c.main) {
      this._main = this._makeButton(c.main, "main");
      this._els.tile.insertBefore(this._main.el, this._els.chips);
    }
    this._chips = c.chips.map((cfg) => {
      const b = this._makeButton(cfg, "chip");
      this._els.chips.appendChild(b.el);
      return b;
    });
    if (!c.chips.length) this._els.chips.remove();
  }

  /* ---- updates, in place ------------------------------------------------ */

  _update() {
    if (!this._hass || !this._els) return;
    const c = this._config;
    this._els.tile.classList.toggle("light-mode", !this._dark);

    const tempObj = this._stateObj(c.temperature);
    const name = c.name || (tempObj && tempObj.attributes.friendly_name) || "Room";
    if (this._els.name.textContent !== name) this._els.name.textContent = name;

    let line = c.temperature ? this._formatTemp(tempObj) : "";
    const pct = this._mainBrightness();
    if (pct !== null && c.main.brightness === "percent") {
      line = line ? `${line} · ${pct}%` : `${pct}%`;
    }
    if (this._els.temp.textContent !== line) this._els.temp.textContent = line;

    if (this._main) this._updateButton(this._main);
    for (const b of this._chips) this._updateButton(b);
  }

  _formatTemp(s) {
    if (!s || s.state === "unavailable" || s.state === "unknown") return "n/a";
    const n = Number(s.state);
    if (!Number.isFinite(n)) return s.state;
    if (!this._numFmt) {
      const lang = (this._hass.locale && this._hass.locale.language) || this._hass.language || "en";
      try {
        this._numFmt = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      } catch (_) {
        this._numFmt = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      }
    }
    const unit = s.attributes.unit_of_measurement || "°C";
    return `${this._numFmt.format(n)} ${unit}`;
  }

  /* Brightness % for a dimmable main light that is on, else null. */
  _mainBrightness() {
    const m = this._config.main;
    if (!m || !m.entity || m.brightness === "none" || domainOf(m.entity) !== "light") return null;
    if (this._isUnavailable(m.entity) || !this._isActive(m.entity)) return null;
    const s = this._stateObj(m.entity);
    const modes = s.attributes.supported_color_modes || [];
    const dimmable = modes.some((x) => x !== "onoff");
    const b = s.attributes.brightness;
    if (!dimmable || typeof b !== "number") return null;
    return Math.max(1, Math.round((b / 255) * 100));
  }

  _iconFor(cfg, s, active) {
    if (cfg.icon) return cfg.icon;
    if (s && s.attributes.icon) return s.attributes.icon;
    if (!cfg.entity) return "mdi:help-circle-outline";
    const d = domainOf(cfg.entity);
    if (d === "binary_sensor") {
      const pair = BINARY_ICONS[s && s.attributes.device_class];
      if (pair) return pair[active ? 1 : 0];
    }
    return DOMAIN_ICONS[d] || "mdi:circle-medium";
  }

  _colorFor(cfg, s) {
    if (cfg.color === "auto") {
      const rgb = s && s.attributes.rgb_color;
      return Array.isArray(rgb) ? `rgb(${rgb.join(",")})` : NAMED_COLORS.amber;
    }
    return resolveColor(cfg.color, "amber");
  }

  _updateButton(b) {
    const { el, cfg, icon } = b;
    const id = cfg.entity;
    const s = this._stateObj(id);
    const unavail = id ? this._isUnavailable(id) : false;
    const active = id && !unavail ? this._isActive(id) : false;

    el.classList.toggle("on", active);
    el.classList.toggle("unavail", unavail);
    el.style.setProperty("--c", this._colorFor(cfg, s));

    const ic = this._iconFor(cfg, s, active);
    if (icon.getAttribute("icon") !== ic) icon.setAttribute("icon", ic);

    if (cfg.tap === "toggle" && TOGGLE_DOMAINS.has(domainOf(id))) {
      el.setAttribute("aria-pressed", String(active));
    }
    let title = "";
    if (id) {
      if (!s) title = `Entity not found: ${id}`;
      else title = `${s.attributes.friendly_name || id}: ${this._displayState(id)}`;
    }
    if (el.title !== title) el.title = title;
    if (el.getAttribute("role") === "button") el.setAttribute("aria-label", title || "button");
  }
}

/* ------------------------------------------------------------------------ */
/* Registration                                                             */
/* ------------------------------------------------------------------------ */

if (!customElements.get("room-card")) {
  customElements.define("room-card", RoomCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "room-card")) {
  window.customCards.push({
    type: "room-card",
    name: "Room Card",
    description: "Fast room tile: name, temperature, main light and up to 3 chips.",
    preview: true,
    documentationURL: "https://github.com/BarBaar44/room-card",
  });
}

console.info(
  `%c ROOM-CARD %c v${VERSION} `,
  "color:#fff;background:#ff9800;font-weight:700;border-radius:3px 0 0 3px",
  "color:#ff9800;background:#fff;font-weight:700;border-radius:0 3px 3px 0"
);
