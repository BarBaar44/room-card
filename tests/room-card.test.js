// Smoke tests for room-card.js in a simulated browser. Run: npm test
const { JSDOM } = require("jsdom");
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, "..", "room-card.js"), "utf8"));
const Card = w.customElements.get("room-card");
assert(Card, "registered");

const st = (state, attrs = {}, lc = "t0") => ({ state, attributes: attrs, last_changed: lc });
let states = {
  "sensor.t": st("21.345", { unit_of_measurement: "°C", friendly_name: "T" }),
  "light.l": st("on", { brightness: 128, supported_color_modes: ["color_temp"], rgb_color: [255, 200, 100] }),
  "binary_sensor.d": st("off", { device_class: "door" }),
  "switch.s": st("off"),
};
const calls = [];
const events = [];
const mkHass = () => ({ states, language: "nl", locale: { language: "nl" },
  callService: (d, s, data) => { calls.push([d, s, data.entity_id]); return Promise.resolve(); } });

const c = new Card();
w.document.body.appendChild(c);
c.addEventListener("hass-more-info", (e) => events.push(e.detail.entityId));
c.setConfig({ name: "Kamer", temperature: "sensor.t",
  main: { entity: "light.l", icon: "mdi:sofa", brightness: "percent" },
  chips: [{ entity: "binary_sensor.d", color: "red", tap: "none" }, { entity: "switch.s", color: "blue" }] });
c.hass = mkHass();
const R = c.shadowRoot;
const main = R.querySelector(".main"), chips = R.querySelectorAll(".chip");
assert.equal(R.querySelector(".name").textContent, "Kamer");
assert.equal(R.querySelector(".temp").textContent, "21,3 °C · 50%");
assert(!R.querySelector(".bar"), "no brightness bar");
assert(main.classList.contains("on"));
assert(!chips[0].classList.contains("clickable"));
assert.equal(chips[0].querySelector(".surface ha-icon").getAttribute("icon"), "mdi:door-closed");

// default colours: yellow for main and light chips, amber for others
assert.equal(main.style.getPropertyValue("--c"), "var(--yellow-color, #ffeb3b)");
assert.equal(chips[0].style.getPropertyValue("--c"), "var(--red-color, #f44336)");
{
  const d = new Card(); w.document.body.appendChild(d);
  d.setConfig({ chips: [{ entity: "light.l" }, { entity: "switch.s" }] });
  d.hass = mkHass();
  const dc = d.shadowRoot.querySelectorAll(".chip");
  assert.equal(dc[0].style.getPropertyValue("--c"), "var(--yellow-color, #ffeb3b)");
  assert.equal(dc[1].style.getPropertyValue("--c"), "var(--amber-color, #ffc107)");
}

// tap via keyboard -> optimistic off
main.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
assert(!main.classList.contains("on"), "optimistic off");
assert.deepEqual(calls.pop(), ["homeassistant", "turn_off", "light.l"]);
// attribute-only update keeps optimistic
states = { ...states, "light.l": { ...states["light.l"], attributes: { ...states["light.l"].attributes, brightness: 130 } } };
c.hass = mkHass();
assert(!main.classList.contains("on"), "still optimistic");
// confirm
states = { ...states, "light.l": st("off", { supported_color_modes: ["color_temp"] }, "t1") };
c.hass = mkHass();
assert(!main.classList.contains("on"));
assert.equal(R.querySelector(".temp").textContent, "21,3 °C", "no % when off");

// unrelated entity change -> no re-render (spy)
let n = 0; const orig = c._update.bind(c); c._update = () => { n++; orig(); };
states = { ...states, "sensor.other": st("1") }; c.hass = mkHass();
assert.equal(n, 0, "no rerender for foreign entity");

// unavailable chip
states = { ...states, "switch.s": st("unavailable") }; c.hass = mkHass();
assert(chips[1].classList.contains("unavail"));
chips[1].dispatchEvent(new w.KeyboardEvent("keydown", { key: " " }));
assert.equal(calls.length, 0, "no call when unavailable");

// rollback timer via fake: set optimistic then ensure timer clears
states = { ...states, "switch.s": st("off") }; c.hass = mkHass();
chips[1].dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
assert(chips[1].classList.contains("on"));
assert.deepEqual(calls.pop(), ["homeassistant", "turn_on", "switch.s"]);
// HA reports a different state than requested -> rollback + failed flash
states = { ...states, "switch.s": st("unavailable", {}, "t2") }; c.hass = mkHass();
assert(!chips[1].classList.contains("on"), "rolled back");
assert(chips[1].classList.contains("failed"), "failure shown");
assert.equal(c._optimistic.size, 0);

// hold -> more-info (pointer events)
const PE = w.PointerEvent || w.MouseEvent;
main.dispatchEvent(new PE("pointerdown", { button: 0, clientX: 5, clientY: 5 }));
setTimeout(() => {
  main.dispatchEvent(new PE("pointerup", { button: 0 }));
  assert.deepEqual(events, ["light.l"], "hold opened more-info");
  assert.equal(calls.length, 0, "hold did not toggle");

  // validation
  const bad = [
    [{ main: { entity: "binary_sensor.d", tap: "toggle" } }, /toggle is not possible/],
    [{ chips: [{}, {}, {}, {}] }, /at most 3/],
    [{ main: { colour: "red", icon: "mdi:x" } }, /unknown option 'colour'/],
    [{ name: "x" }, /at least one/],
    [{ main: { icon: "mdi:x", brightness: "bar" } }, /brightness must be one of percent, none/],
  ];
  for (const [cfg, re] of bad) assert.throws(() => new Card().setConfig(cfg), re);
  // sport room
  const sp = new Card(); w.document.body.appendChild(sp);
  sp.setConfig({ name: "Sport", temperature: "sensor.t", main: { icon: "mdi:bike-fast" } });
  sp.hass = mkHass();
  assert(!sp.shadowRoot.querySelector(".main").classList.contains("clickable"));
  assert(!sp.shadowRoot.querySelector(".chips"));
  assert(Card.getStubConfig(mkHass()).main.entity === "light.l");
  const cc = new Card(); w.document.body.appendChild(cc);
  cc.setConfig({ temperature: "sensor.t", colors: { name: "white", icon_off: "#555", card_background: "rgb(1,2,3)" } });
  assert.equal(cc.style.getPropertyValue("--room-card-name-color"), "var(--white-color, #ffffff)");
  assert.equal(cc.style.getPropertyValue("--room-card-off-color"), "#555");
  assert.equal(cc.style.getPropertyValue("--ha-card-background"), "rgb(1,2,3)");
  cc.setConfig({ temperature: "sensor.t" });
  assert.equal(cc.style.getPropertyValue("--room-card-off-color"), "", "cleared on reconfig");
  assert.throws(() => new Card().setConfig({ temperature: "sensor.t", colors: { nmae: "red" } }), /unknown option 'nmae'/);
  // service call rejected -> rollback + failed flash
  states = { ...states, "switch.s": st("off", {}, "t3") };
  const failing = { ...mkHass(), callService: () => Promise.reject(new Error("boom")) };
  const notes = [];
  c.addEventListener("hass-notification", (e) => notes.push(e.detail.message));
  c.hass = failing;
  chips[1].classList.remove("failed");
  chips[1].dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter" }));
  assert(chips[1].classList.contains("on"), "optimistic on");
  setTimeout(() => {
    assert(!chips[1].classList.contains("on"), "rolled back after error");
    assert(chips[1].classList.contains("failed"), "failure shown after error");
    assert(/boom/.test(notes[0]), "notification sent");
    editorTests().then(() => {
      console.log("ALL OK");
      process.exit(0);
    }).catch((e) => { console.error(e); process.exit(1); });
  }, 20);
}, 600);

async function editorTests() {
  const Editor = w.customElements.get("room-card-editor");
  assert(Editor, "editor registered");
  assert.equal(Card.getConfigElement().tagName.toLowerCase(), "room-card-editor");

  const cfg = {
    type: "custom:room-card", name: "Gijs", temperature: "sensor.t",
    main: { entity: "switch.s", icon: "mdi:bed" },
    chips: [{ entity: "binary_sensor.d", color: "red", tap: "none" }],
    colors: { name: "white" }, grid_options: { rows: 3 },
  };
  // round trip keeps everything, including keys the editor does not know
  assert.deepEqual(Editor.toConfig(Editor.toData(cfg), cfg), cfg);
  // emptied fields disappear, empty chip slots are skipped, order kept
  const d = Editor.toData(cfg);
  d.chip_1 = {}; d.chip_3 = { entity: "switch.s", color: "" };
  d.main = { entity: "", icon: "" }; d.colors = { name: "" };
  const out = Editor.toConfig(d, cfg);
  assert.deepEqual(out, { type: "custom:room-card", grid_options: { rows: 3 }, name: "Gijs",
    temperature: "sensor.t", chips: [{ entity: "switch.s" }] });

  // with a stub ha-form: renders, and form changes fire config-changed
  w.customElements.define("ha-form", class extends w.HTMLElement {});
  const ed = new Editor();
  const got = [];
  ed.addEventListener("config-changed", (e) => got.push(e.detail.config));
  ed.setConfig(cfg);
  ed.hass = mkHass();
  w.document.body.appendChild(ed);
  await new Promise((r) => setTimeout(r, 0));
  const form = ed.querySelector("ha-form");
  assert(form, "ha-form rendered");
  assert.equal(form.data.chip_1.entity, "binary_sensor.d");
  assert.equal(form.computeLabel({ name: "temperature" }), "Temperature sensor");
  const nd = { ...form.data, name: "Gijs Room" };
  form.dispatchEvent(new w.CustomEvent("value-changed", { detail: { value: nd } }));
  assert.equal(got[0].name, "Gijs Room");
  assert.equal(got[0].grid_options.rows, 3);
  // every config the editor produces is accepted by the card
  new Card().setConfig(got[0]);
}
