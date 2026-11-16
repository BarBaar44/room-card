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
  "sensor.outdoor_sensor_illuminance": st("2"),
  "sun.sun": st("below_horizon"),
  "light.rear_garden": st("on"),
  "binary_sensor.front_door_sensor_contact": st("off"),
  "binary_sensor.backdoors_garden": st("off"),
  "binary_sensor.door_sensor_kitchen_contact": st("off"),
  "sensor.temperature_room_tim_temperature": st("19.84"),
  "switch.shelly1_tim_shelly1_shelly1_tim": st("off"),
  "switch.sonoff_tim_sonoff_tim": st("off"),
  "sensor.temperature_room_gijs_temperature": st("20.2"),
  "switch.shelly1_gijs_shelly1_shelly1_gijs": st("off"),
  "switch.sonoff_gijs_sonoff_gijs": st("on"),
  "switch.light_studyroom": st("on"),
  "light.sonoff_ifan_ifan03_masterbedroom_light": st("off"),
  "fan.sonoff_ifan_ifan03_masterbedroom_fan": st("off"),
  "sensor.temperature_bathroom_temperature": st("22.1"),
  "sensor.temperature_bathroom_humidity": st("78"),
  "light.bathroom_light_rl": st("on"),
  "switch.sonoff_fb_sonoff_fb": st("on"),
  "switch.switch_hallway": st("off"),
  "sensor.temperature_living_room_temperature": st("21.3"),
  "light.livingroom_lights": st("on"),
  "climate.virtual_thermostat_living_room": st("heat", { hvac_action: "heating", temperature: 21.5 }),
});

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
  c.setConfig({});
  c.hass = mkHass();
  const R = c.shadowRoot;
  const q = (s) => R.querySelector(s);
  const act = (a) => R.querySelector(`[data-act="${a}"]`);

  // header
  assert.equal(q(".name").textContent, "Home");
  assert.equal(q(".big").textContent, "4lights on", "living, office, bath, Gijs bed light");
  assert.equal(q(".line").textContent, "Bath 78 %, fan on · Living heating to 21,5°");
  assert(!q(".alloff").disabled);

  // drawing: labels, temperatures in the locale, lit and dark rooms
  const svg = q(".pic svg");
  assert(svg, "drawing rendered");
  assert(svg.textContent.includes("Tim") && svg.textContent.includes("19,8°"), "short name and temperature");
  assert(svg.textContent.includes("78 %"), "bathroom humidity shown above the alert level");
  const fillOf = (a) => act(a).querySelector("rect, polygon").getAttribute("fill");
  assert(/-lit\)$/.test(fillOf("living")), "lit room glows");
  assert.equal(fillOf("hall"), "#1a1a1a", "dark room is black glass at night");
  assert(act("kitchen").classList.contains("na"), "kitchen without a light entity is not interactive");

  // day: dark rooms turn silver
  states = { ...states, "sensor.outdoor_sensor_illuminance": st("800") };
  c.hass = mkHass();
  assert(/-day\)$/.test(fillOf("hall")), "silver by day");
  // dark sensor unavailable: falls back to the sun
  states = { ...states, "sensor.outdoor_sensor_illuminance": st("unavailable") };
  c.hass = mkHass();
  assert.equal(fillOf("hall"), "#1a1a1a", "sun below the horizon counts as dark");

  // tap a room: optimistic, explicit turn_off
  key(act("living"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "light.livingroom_lights"]);
  assert.equal(fillOf("living"), "#1a1a1a", "optimistic off");
  assert.equal(q(".big").textContent, "3lights on");
  // attribute-only update keeps the optimistic state
  states = { ...states, "light.livingroom_lights": { ...states["light.livingroom_lights"], attributes: { brightness: 3 } } };
  c.hass = mkHass();
  assert.equal(fillOf("living"), "#1a1a1a", "still optimistic");
  // confirm
  states = { ...states, "light.livingroom_lights": st("off") };
  c.hass = mkHass();
  assert.equal(fillOf("living"), "#1a1a1a");

  // tap a room whose light changes to something else: rollback and failure flash
  key(act("office"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "switch.light_studyroom"]);
  states = { ...states, "switch.light_studyroom": st("unavailable") };
  c.hass = mkHass();
  assert(act("office").classList.contains("failed"), "failure flash");
  assert(act("office").classList.contains("unavail"), "unavailable light dims the room");
  assert.equal(q(".name").textContent, "Office light unavailable");
  assert(q(".name").classList.contains("notice"));
  key(act("office"), "Enter");
  assert.equal(calls.length, 0, "no call for an unavailable light");
  states = { ...states, "switch.light_studyroom": st("on") };
  c.hass = mkHass();

  // service call fails: rollback and a notification
  failNext = true;
  key(act("hall"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_on", "switch.switch_hallway"]);
  await flush();
  assert.equal(fillOf("hall"), "#1a1a1a", "rolled back");
  assert(notes.length === 1 && notes[0].includes("boom"));

  // fans and bed lights
  key(act("masterFan"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_on", "fan.sonoff_ifan_ifan03_masterbedroom_fan"]);
  assert(act("masterFan").querySelector(".spin"), "fan spins at once");
  key(act("gijsSpot"), "Enter");
  assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "switch.sonoff_gijs_sonoff_gijs"]);
  key(act("kitchen"), "Enter");
  assert.equal(calls.length, 0, "nothing configured, nothing called");
  // hold on a device: more-info
  key(act("lantern"), "Enter", true);
  assert.deepEqual(moreInfo.splice(0), ["light.rear_garden"]);

  // unrelated entity: no re-render
  let n = 0; const orig = c._update.bind(c); c._update = () => { n++; orig(); };
  states = { ...states, "sensor.unrelated": st("1") };
  c.hass = mkHass();
  assert.equal(n, 0, "no re-render for a foreign entity");
  c._update = orig;

  // warnings: doors first, in the warning colour
  states = { ...states, "binary_sensor.front_door_sensor_contact": st("on"), "binary_sensor.backdoors_garden": st("on") };
  c.hass = mkHass();
  assert.equal(q(".name").textContent, "Front door open +1");
  assert(q(".name").classList.contains("warn"));

  // hold a room: details pop-up; rows open more-info
  key(act("bath"), "Enter", true);
  const dlg = q("dialog");
  assert(dlg.open || dlg.hasAttribute("open"), "details open");
  assert.equal(q(".dh .t").textContent, "Bathroom");
  const rows = [...R.querySelectorAll(".row")].map((r) => r.firstChild.textContent);
  assert.deepEqual(rows, ["Temperature", "Humidity", "Light", "Fan"]);
  R.querySelectorAll(".row")[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(moreInfo.splice(0), ["sensor.temperature_bathroom_humidity"]);
  q(".dh .x").click();
  assert(!(dlg.open || dlg.hasAttribute("open")), "details closed");
  // a room without a light opens details on tap
  key(act("sport"), "Enter");
  assert.equal(q(".dh .t").textContent, "Sport Room");
  q(".dh .x").click();

  // All off: one call with every lit room light and bed light
  calls.length = 0;
  q(".alloff").click();
  const [d, s, ids] = calls.pop();
  assert.equal(`${d}.${s}`, "homeassistant.turn_off");
  assert.deepEqual([...ids].sort(), ["light.bathroom_light_rl", "switch.light_studyroom"]);
  assert.equal(q(".big").textContent, "All off");
  assert(q(".alloff").disabled);

  // config: overrides, nulls, errors
  {
    const d2 = new Card(); w.document.body.appendChild(d2);
    d2.setConfig({ name: "Thuis", rooms: { tim: { short_name: "T", light: null }, living: { name: "Woonkamer" } }, entities: { dark: "binary_sensor.donker" } });
    states = { ...states, "binary_sensor.donker": st("off") };
    d2.hass = mkHass();
    const r2 = d2.shadowRoot;
    assert(r2.querySelector(".pic svg").textContent.includes("Woonkamer"), "name used when no short name");
    key(r2.querySelector('[data-act="tim"]'), "Enter");
    assert.equal(r2.querySelector(".dh .t").textContent, "Tim Room", "no light: tap opens details");
    assert(/-day\)$/.test(r2.querySelector('[data-act="hall"] rect').getAttribute("fill")), "binary dark sensor off: day");
  }
  const bad = (cfg, re) => assert.throws(() => new Card().setConfig(cfg), re);
  bad({ temperature: "sensor.t" }, /v0\.2 options/);
  bad({ rooms: { attic: {} } }, /unknown option 'attic'/);
  bad({ rooms: { tim: { fan: "fan.x" } } }, /unknown option 'fan'/);
  bad({ rooms: { tim: { light: "sensor.x" } } }, /cannot be switched/);
  bad({ entities: { lantern: "not an id" } }, /not a valid entity id/);
  bad({ humidity_alert: "lots" }, /must be a number/);

  // editor: shows defaults, writes only differences, keeps unknown keys
  const data = Editor.toData({});
  assert.equal(data.room_bath.light, "light.bathroom_light_rl");
  assert.equal(data.entities.kitchen_light, "");
  assert.deepEqual(Editor.toConfig(data, { type: "custom:room-card", grid_options: { rows: 7 } }), { type: "custom:room-card", grid_options: { rows: 7 } });
  data.room_bath.shower = "binary_sensor.shower";
  data.room_tim.bed_light = "";
  data.entities.kitchen_light = "light.kitchen";
  data.humidity_alert = 75;
  assert.deepEqual(Editor.toConfig(data, {}), {
    type: "custom:room-card", humidity_alert: 75, entities: { kitchen_light: "light.kitchen" },
    rooms: { tim: { bed_light: null }, bath: { shower: "binary_sensor.shower" } },
  });
  const round = Editor.toData(Editor.toConfig(data, {}));
  assert.equal(round.room_tim.bed_light, "", "cleared default stays cleared");
  assert.equal(round.room_bath.shower, "binary_sensor.shower");

  console.log("room-card tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
