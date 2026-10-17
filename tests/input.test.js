import test from "node:test";
import assert from "node:assert/strict";

class Element extends EventTarget {
  constructor(dataset = {}, bounds = { left: 0, top: 0, width: 200, height: 200 }) {
    super();
    this.dataset = dataset;
    this.bounds = bounds;
    this.tagName = "DIV";
    this.children = [];
    this.attributes = new Map();
    this.captures = new Set();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, active) => active ? classes.add(name) : classes.delete(name),
    };
    const style = new Map();
    this.style = {
      setProperty: (name, value) => style.set(name, value),
      getPropertyValue: (name) => style.get(name),
    };
  }
  getBoundingClientRect() { return this.bounds; }
  querySelectorAll(selector) {
    return selector === "[data-jets]" ? this.children : [];
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}

const drive = new Element({ touchPad: "drive" });
const flight = new Element({ touchPad: "flight" }, { left: 220, top: 0, width: 180, height: 180 });
flight.children = ["q", "qw", "w", "qo", "qwop", "wp", "o", "op", "p"]
  .map((jets) => new Element({ jets }));
const boost = new Element({ control: "boost" });
const duplicateBoost = new Element({ control: "boost" });
const elements = [drive, flight, boost, duplicateBoost, ...flight.children];

globalThis.window = new Element();
window.matchMedia = () => ({ matches: true });
globalThis.document = new Element();
document.documentElement = new Element();
document.hidden = false;
document.querySelector = () => null;
document.querySelectorAll = (selector) => {
  if (selector === "[data-control]") return [boost, duplicateBoost];
  if (selector === "[data-touch-pad]") return [drive, flight];
  if (selector === ".held") return elements.filter((element) => element.classList.contains("held"));
  return [];
};

const { Input } = await import("../src/input.js");
const { getControlMode, subscribeControlMode } = await import("../src/control-mode.js");
const input = new Input();
input.bind();
input.enabled = true;

function event(type, fields = {}) {
  const value = new Event(type, { cancelable: true });
  Object.assign(value, fields);
  return value;
}

function pointer(type, element, id, x, y, pointerType = "touch") {
  const fields = { pointerId: id, clientX: x, clientY: y, pointerType, button: 0 };
  // Browser capture listeners see the touch before the element's handlers.
  window.dispatchEvent(event(type, fields));
  if (element) element.dispatchEvent(event(type, fields));
}

function key(type, code, repeat = false) {
  window.dispatchEvent(event(type, { code, repeat }));
}

function jetState() {
  return ["q", "w", "o", "p"].map((key) => input.state[key]);
}

test("touch pads independently combine analog drive, selected jets, and rear thrust", () => {
  assert.equal(getControlMode(), "touch", "a coarse primary pointer starts with touch controls");
  pointer("pointerdown", drive, 1, 184, 16);
  pointer("pointerdown", flight, 2, 310, 90);
  pointer("pointerdown", boost, 3, 0, 0);
  assert.deepEqual(input.state, { q: 1, w: 1, o: 1, p: 1, throttle: 1, brake: 0, steer: 1, boost: 1 });
  assert.ok(parseFloat(drive.style.getPropertyValue("--stick-x")) > 0);
  assert.ok(parseFloat(drive.style.getPropertyValue("--stick-y")) < 0);

  pointer("pointermove", null, 1, 110, 110);
  assert.equal(input.state.throttle, 0, "small center movements stay in the deadzone");
  assert.equal(input.state.brake, 0);
  assert.equal(input.state.steer, 0);
  pointer("pointermove", null, 1, 100, 142);
  assert.ok(input.state.brake > 0.4 && input.state.brake < 0.42, "braking is analog");
  assert.equal(input.state.throttle, 0);
  assert.deepEqual(jetState(), [1, 1, 1, 1]);

  for (const [element, id] of [[drive, 1], [flight, 2], [boost, 3]]) pointer("pointerup", element, id, 0, 0);
  assert.deepEqual(input.state, { q: 0, w: 0, o: 0, p: 0, throttle: 0, brake: 0, steer: 0, boost: 0 });
  assert.equal(drive.style.getPropertyValue("--stick-x"), "0px");
});

test("sliding the flight pad selects every corner and pair, and leaving it stops the jets", () => {
  const expected = [
    [1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0],
    [1, 0, 1, 0], [1, 1, 1, 1], [0, 1, 0, 1],
    [0, 0, 1, 0], [0, 0, 1, 1], [0, 0, 0, 1],
  ];
  pointer("pointerdown", flight, 4, 250, 30);
  expected.forEach((jets, index) => {
    pointer("pointermove", null, 4, 250 + index % 3 * 60, 30 + Math.floor(index / 3) * 60);
    assert.deepEqual(jetState(), jets);
    assert.equal(flight.children[index].getAttribute("aria-pressed"), "true");
    assert.equal(flight.children.filter((cell) => cell.classList.contains("active")).length, 1);
  });
  pointer("pointermove", null, 4, 420, 150);
  assert.deepEqual(jetState(), [0, 0, 0, 0]);
  pointer("pointermove", null, 4, 310, 30);
  assert.deepEqual(jetState(), [1, 1, 0, 0], "the captured finger can slide back into the pad");
  pointer("pointercancel", flight, 4, 0, 0);
  assert.deepEqual(jetState(), [0, 0, 0, 0]);
});

test("releasing one of two fingers does not release another finger's selected jet or booster", () => {
  pointer("pointerdown", flight, 5, 250, 30);
  pointer("pointerdown", flight, 6, 250, 30);
  pointer("pointerup", flight, 5, 250, 30);
  assert.deepEqual(jetState(), [1, 0, 0, 0]);
  assert.equal(flight.children[0].getAttribute("aria-pressed"), "true");
  pointer("pointerup", flight, 6, 250, 30);
  assert.deepEqual(jetState(), [0, 0, 0, 0]);
  assert.equal(flight.children[0].getAttribute("aria-pressed"), "false");

  pointer("pointerdown", boost, 7, 0, 0);
  pointer("pointerdown", duplicateBoost, 8, 0, 0);
  pointer("pointerup", boost, 7, 0, 0);
  assert.equal(input.state.boost, 1);
  assert.equal(boost.classList.contains("held"), false);
  assert.equal(duplicateBoost.classList.contains("held"), true);
  pointer("pointerup", duplicateBoost, 8, 0, 0);
  assert.equal(input.state.boost, 0);
});

test("the drive pad keeps its first thumb and releasing it returns all axes to neutral", () => {
  pointer("pointerdown", drive, 9, 100, 16);
  pointer("pointerdown", drive, 10, 16, 184);
  assert.equal(input.state.throttle, 1);
  assert.equal(input.state.brake, 0);
  assert.equal(input.state.steer, 0);
  pointer("pointerup", drive, 10, 16, 184);
  assert.equal(input.state.throttle, 1);
  pointer("pointerup", drive, 9, 100, 16);
  assert.equal(input.state.throttle, 0);
  assert.equal(drive.classList.contains("held"), false);
});

test("reset or pause clear releases captured pads and keyboard repeats cannot rearm controls", () => {
  pointer("pointerdown", drive, 11, 100, 16);
  pointer("pointerdown", flight, 12, 310, 90);
  key("keydown", "Space");
  input.clear();
  pointer("pointermove", null, 11, 184, 16);
  pointer("pointermove", null, 12, 310, 30);
  key("keydown", "Space", true);
  assert.deepEqual(input.state, { q: 0, w: 0, o: 0, p: 0, throttle: 0, brake: 0, steer: 0, boost: 0 });
  assert.equal(input.pointers.size, 0);
  assert.equal(input.padPointers.size, 0);
  assert.equal(input.captureTargets.size, 0);
  assert.equal(drive.captures.size + flight.captures.size, 0);
  assert.equal(flight.children.some((cell) => cell.classList.contains("active")), false);
  assert.equal(drive.style.getPropertyValue("--stick-x"), "0px");
  pointer("pointerup", drive, 11, 184, 16);
  pointer("pointerup", flight, 12, 310, 30);
  key("keyup", "Space");
  key("keydown", "Space");
  assert.equal(input.state.boost, 1, "a fresh press can arm the rocket again");
  key("keyup", "Space");
});

test("keyboard input stays functional on hybrid devices while layout waits for the last touch", () => {
  const modes = [];
  const unsubscribe = subscribeControlMode((mode) => modes.push(mode));
  pointer("pointerdown", drive, 13, 100, 16);
  pointer("pointerdown", flight, 14, 250, 30);
  assert.equal(getControlMode(), "touch");
  key("keydown", "KeyP");
  assert.equal(input.state.p, 1);
  assert.equal(getControlMode(), "touch");
  pointer("pointerup", flight, 14, 250, 30);
  assert.equal(getControlMode(), "touch");
  pointer("pointerup", drive, 13, 100, 16);
  assert.equal(getControlMode(), "keyboard");
  assert.equal(document.documentElement.dataset.input, "keyboard");
  key("keyup", "KeyP");
  key("keydown", "ArrowRight");
  assert.equal(input.state.steer, 1);
  key("keyup", "ArrowRight");
  assert.equal(input.state.steer, 0);
  assert.deepEqual(modes, ["touch", "keyboard"]);
  unsubscribe();
});

test("lost capture and blur release touch input even when no pointerup arrives", () => {
  pointer("pointerdown", flight, 15, 310, 90);
  flight.dispatchEvent(event("lostpointercapture", { pointerId: 15 }));
  assert.deepEqual(jetState(), [0, 0, 0, 0]);
  pointer("pointerdown", drive, 16, 184, 16);
  window.dispatchEvent(new Event("blur"));
  assert.equal(input.state.throttle, 0);
  assert.equal(input.state.steer, 0);
  assert.equal(input.pointers.size, 0);
});
