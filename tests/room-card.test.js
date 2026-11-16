// Tests for room-card.js in a simulated browser. Run: npm test
const { JSDOM } = require("jsdom");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, "..", "room-card.js"), "utf8"));
const Card = w.customElements.get("room-card");
const Editor = w.customElements.get("room-card-editor");
assert(Card, "card registered");
assert(Editor, "editor registered");

let tick = 0;
const st = (state, attributes = {}) => ({ state, attributes, last_changed: `t${tick++}` });
const night = () => ({
  "sensor.outdoor_illuminance": st("2"),
  "sun.sun": st("below_horizon"),
  "light.garden_lantern": st("on"),
  "binary_sensor.front_door": st("off"),
  "binary_sensor.garden_doors": st("off"),
  "binary_sensor.kitchen_door": st("off"),
  "sensor.attic_bedroom_temperature": st("19.84"),
  "switch.attic_bedroom_light": st("off"),
  "switch.attic_bedroom_bed_light": st("off"),
  "sensor.bedroom_1_temperature": st("20.2"),
  "switch.bedroom_1_light": st("off"),
  "switch.bedroom_1_bed_light": st("on"),
  "switch.office_light": st("on"),
  "light.main_bedroom": st("off"),
  "fan.main_bedroom": st("off"),
  "sensor.bathroom_temperature": st("22.1"),
  "sensor.bathroom_humidity": st("78"),
  "light.bathroom": st("on"),
  "switch.bathroom_fan": st("on"),
  "switch.hallway_light": st("off"),
  "sensor.living_room_temperature": st("21.3"),
  "light.living_room": st("on"),
  "climate.living_room": st("heat", { hvac_action: "heating", temperature: 21.5 }),
});

const CFG = {
  entities: { dark: "sensor.outdoor_illuminance", lantern: "light.garden_lantern", front_door: "binary_sensor.front_door", garden_door: "binary_sensor.garden_doors", kitchen_door: "binary_sensor.kitchen_door" },
  rooms: {
    attic_left: { temperature: "sensor.attic_bedroom_temperature", light: "switch.attic_bedroom_light", bed_light: "switch.attic_bedroom_bed_light" },
    attic_right: { temperature: "sensor.gym_temperature" },
    first_1: { temperature: "sensor.bedroom_1_temperature", light: "switch.bedroom_1_light", bed_light: "switch.bedroom_1_bed_light" },
    first_2: { light: "switch.office_light" },
    first_3: { light: "light.main_bedroom", fan: "fan.main_bedroom" },
    first_4: { temperature: "sensor.bathroom_temperature", humidity: "sensor.bathroom_humidity", light: "light.bathroom", fan: "switch.bathroom_fan" },
    ground_left: { light: "switch.hallway_light" },
    ground_right: { temperature: "sensor.living_room_temperature", light: "light.living_room", climate: "climate.living_room" },
  },
};
let states = night();
const calls = [];
let failNext = false;
const mkHass = () => ({
  states, language: "nl", locale: { language: "nl" },
  callService: (d, s, data) => {
    calls.push([d, s, data.entity_id]);
    if (failNext) { failNext = false; return Promise.reject(new Error("boom")); }
    return Promise.resolve();
  },
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (el, k, shift = false) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));

(async () => {
  const c = new Card();
  w.document.body.appendChild(c);
  const moreInfo = [];
  const notes = [];
  c.addEventListener("hass-more-info", (e) => moreInfo.push(e.detail.entityId));
  c.addEventListener("hass-notification", (e) => notes.push(e.detail.message));
  c.setConfig(CFG);
  c.hass = mkHass();
  const R = c.shadowRoot;
  const q = (s) => R.querySelector(s);
  const act = (a) => R.querySelector(`[data-act="${a}"]`);

  // header
  assert.equal(q(".name").textContent, "Home");
  assert.equal(q(".big").textContent, "4lights on", "living room, office, bathroom, bedroom 1 bed light");
  assert.equal(q(".line").textContent, "Bath 78 %, fan on · Living heating to 21,5°");
  assert(!q(".alloff").disabled);

  // drawing: labels, temperatures in the locale, lit and dark rooms
  const svg = q(".pic svg");
  assert(svg, "drawing rendered");
  assert(svg.textContent.includes("Attic") && svg.textContent.includes("19,8°"), "short name and temperature");
  assert(svg.textContent.includes("78 %"), "bathroom humidity shown above the alert level");
  const fillOf = (a) => act(a).querySelector("rect, polygon").getAttribute("fill");
  assert(/-lit\)$/.test(fillOf("ground_right")), "lit room glows");
  assert.equal(fillOf("ground_left"), "#1a1a1a", "dark room is black glass at night");
  assert(act("kitchen").classList.contains("na"), "kitchen without a light entity is not interactive");

  // day: dark rooms turn silver
  states = { ...states, "sensor.outdoor_illuminance": st("800") };
  c.hass = mkHass();
  assert(/-day\)$/.test(fillOf("ground_left")), "silver by day");
  // dark sensor unavailable: falls back to the sun
  states = { ...states, "sensor.outdoor_illuminance": st("unavailable") };
  c.hass = mkHass();
  assert.equal(fillOf("ground_left"), "#1a1a1a", "sun below the horizon counts as dark");

  // tap a room: optimistic, explicit turn_off
  key(act("ground_right"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "light.living_room"]);
  assert.equal(fillOf("ground_right"), "#1a1a1a", "optimistic off");
  assert.equal(q(".big").textContent, "3lights on");
  // attribute-only update keeps the optimistic state
  states = { ...states, "light.living_room": { ...states["light.living_room"], attributes: { brightness: 3 } } };
  c.hass = mkHass();
  assert.equal(fillOf("ground_right"), "#1a1a1a", "still optimistic");
  // confirm
  states = { ...states, "light.living_room": st("off") };
  c.hass = mkHass();
  assert.equal(fillOf("ground_right"), "#1a1a1a");

  // tap a room whose light changes to something else: rollback and failure flash
  key(act("first_2"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "switch.office_light"]);
  states = { ...states, "switch.office_light": st("unavailable") };
  c.hass = mkHass();
  assert(act("first_2").classList.contains("failed"), "failure flash");
  assert(act("first_2").classList.contains("unavail"), "unavailable light dims the room");
  assert.equal(q(".name").textContent, "Office light unavailable");
  assert(q(".name").classList.contains("notice"));
  key(act("first_2"), "Enter");
  assert.equal(calls.length, 0, "no call for an unavailable light");
  states = { ...states, "switch.office_light": st("on") };
  c.hass = mkHass();

  // service call fails: rollback and a notification
  failNext = true;
  key(act("ground_left"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_on", "switch.hallway_light"]);
  await flush();
  assert.equal(fillOf("ground_left"), "#1a1a1a", "rolled back");
  assert(notes.length === 1 && notes[0].includes("boom"));

  // fans and bed lights
  key(act("fan_first_3"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_on", "fan.main_bedroom"]);
  assert(act("fan_first_3").querySelector(".spin"), "fan spins at once");
  key(act("bed_first_1"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "switch.bedroom_1_bed_light"]);
  key(act("kitchen"), "Enter");
  assert.equal(calls.length, 0, "nothing configured, nothing called");
  // hold on a device: more-info
  key(act("lantern"), "Enter", true);
  assert.deepEqual(moreInfo.splice(0), ["light.garden_lantern"]);

  // unrelated entity: no re-render
  let n = 0; const orig = c._update.bind(c); c._update = () => { n++; orig(); };
  states = { ...states, "sensor.unrelated": st("1") };
  c.hass = mkHass();
  assert.equal(n, 0, "no re-render for a foreign entity");
  c._update = orig;

  // warnings: doors first, in the warning colour
  states = { ...states, "binary_sensor.front_door": st("on"), "binary_sensor.garden_doors": st("on") };
  c.hass = mkHass();
  assert.equal(q(".name").textContent, "Front door open +1");
  assert(q(".name").classList.contains("warn"));

  // hold a room: details pop-up; rows open more-info
  key(act("first_4"), "Enter", true);
  const dlg = q("dialog");
  assert(dlg.open || dlg.hasAttribute("open"), "details open");
  assert.equal(q(".dh .t").textContent, "Bathroom");
  const rows = [...R.querySelectorAll(".row")].map((r) => r.firstChild.textContent);
  assert.deepEqual(rows, ["Temperature", "Humidity", "Light", "Fan"]);
  R.querySelectorAll(".row")[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(moreInfo.splice(0), ["sensor.bathroom_humidity"]);
  q(".dh .x").click();
  assert(!(dlg.open || dlg.hasAttribute("open")), "details closed");
  // a room without a light opens details on tap
  key(act("attic_right"), "Enter");
  assert.equal(q(".dh .t").textContent, "Gym");
  q(".dh .x").click();

  // All off: one call with every lit room light and bed light
  calls.length = 0;
  q(".alloff").click();
  const [d, s, ids] = calls.pop();
  assert.equal(`${d}.${s}`, "homeassistant.turn_off");
  assert.deepEqual([...ids].sort(), ["light.bathroom", "switch.office_light"]);
  assert.equal(q(".big").textContent, "All off");
  assert(q(".alloff").disabled);

  // config: overrides, nulls, errors
  {
    const d2 = new Card(); w.document.body.appendChild(d2);
    d2.setConfig({ name: "Thuis", rooms: { ...CFG.rooms, attic_left: { short_name: "A", light: null }, ground_right: { name: "Woonkamer" } }, entities: { dark: "binary_sensor.dark" } });
    states = { ...states, "binary_sensor.dark": st("off") };
    d2.hass = mkHass();
    const r2 = d2.shadowRoot;
    assert(r2.querySelector(".pic svg").textContent.includes("Woonkamer"), "name used when no short name");
    key(r2.querySelector('[data-act="attic_left"]'), "Enter");
    assert.equal(r2.querySelector(".dh .t").textContent, "Attic bedroom", "no light: tap opens details");
    assert(/-day\)$/.test(r2.querySelector('[data-act="ground_left"] rect').getAttribute("fill")), "binary dark sensor off: day");
  }
  {
    // empty config: the house with neutral names and no data, no error
    const e = new Card(); w.document.body.appendChild(e);
    e.setConfig({});
    e.hass = mkHass();
    const re = e.shadowRoot;
    const txt = re.querySelector(".pic svg").textContent;
    for (const n of ["Attic", "Gym", "Bedroom 1", "Office", "Bedroom", "Bath", "Hall", "Living"]) assert(txt.includes(n), `neutral label ${n}`);
    assert(!/\d°/.test(txt), "no temperatures without sensors");
    assert.equal(re.querySelector(".name").textContent, "Home");
    assert.equal(re.querySelector(".big").textContent, "All off");
    key(re.querySelector('[data-act="first_4"]'), "Enter");
    assert.equal(re.querySelector(".dh .t").textContent, "Bathroom", "no light: details");
  }
  const bad = (cfg, re) => assert.throws(() => new Card().setConfig(cfg), re);
  bad({ temperature: "sensor.t" }, /v0\.2 options/);
  bad({ rooms: { attic: {} } }, /unknown room key 'attic'.*valid keys are attic_left, attic_right, first_1/);
  bad({ rooms: { attic_left: { fan: "fan.x" } } }, /unknown option 'fan'/);
  bad({ rooms: { attic_left: { light: "sensor.x" } } }, /cannot be switched/);
  bad({ entities: { lantern: "not an id" } }, /not a valid entity id/);
  bad({ humidity_alert: "lots" }, /must be a number/);

  // editor: shows defaults, writes only differences, keeps unknown keys
  const data = Editor.toData({});
  assert.equal(data.room_first_4.name, "Bathroom");
  assert.equal(data.room_first_4.light, "", "no entity defaults");
  assert.equal(data.entities.sun, "sun.sun");
  assert.deepEqual(Editor.toConfig(data, { type: "custom:room-card", grid_options: { rows: 7 } }), { type: "custom:room-card", grid_options: { rows: 7 } });
  data.room_first_4.shower = "binary_sensor.shower";
  data.room_attic_left.short_name = "Loft";
  data.entities.sun = "";
  data.entities.kitchen_light = "light.kitchen";
  data.humidity_alert = 75;
  assert.deepEqual(Editor.toConfig(data, {}), {
    type: "custom:room-card", humidity_alert: 75, entities: { sun: null, kitchen_light: "light.kitchen" },
    rooms: { attic_left: { short_name: "Loft" }, first_4: { shower: "binary_sensor.shower" } },
  });
  const round = Editor.toData(Editor.toConfig(data, {}));
  assert.equal(round.entities.sun, "", "cleared default stays cleared");
  assert.equal(round.room_first_4.shower, "binary_sensor.shower");
  assert.equal(round.room_attic_left.short_name, "Loft");

  console.log("room-card tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
