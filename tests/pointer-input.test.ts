import assert from "node:assert/strict";
import test from "node:test";
import { getHardwarePointerMode } from "../src/pointerInput.ts";

test("recognizes the Wacom eraser tip button and bitmask", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: 5, buttons: 32 }), "eraser");
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: -1, buttons: 32 }), "eraser");
});

test("recognizes WebView eraser pointer types", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "eraser", button: 0, buttons: 1 }), "eraser");
  assert.equal(getHardwarePointerMode({ pointerType: "eraser", button: -1, buttons: 0 }), "eraser");
  assert.equal(getHardwarePointerMode({ pointerType: "3", button: 0, buttons: 1 }), "eraser");
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: 0, buttons: 1, eraser: true }), "eraser");
});

test("recognizes the Wacom erase barrel button", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: 2, buttons: 2 }), "eraser");
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: -1, buttons: 2 }), "eraser");
});

test("uses the legacy Wacom button-1 signature for panning", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: 1, buttons: 1 }), "pan");
});

test("recognizes Wacom pad-style auxiliary input without pen pressure", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "mouse", button: 1, buttons: 1 }), "pan");
  assert.equal(getHardwarePointerMode({ pointerType: "mouse", button: -1, buttons: 4 }), "pan");
});

test("recognizes Wacom pan and middle-button panning", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: 1, buttons: 4 }), "pan");
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: -1, buttons: 4 }), "pan");
  assert.equal(getHardwarePointerMode({ pointerType: "mouse", button: 1, buttons: 4 }), "pan");
});

test("leaves ordinary pen contact in drawing mode", () => {
  assert.equal(getHardwarePointerMode({ pointerType: "pen", button: 0, buttons: 1 }), null);
  assert.equal(getHardwarePointerMode({ pointerType: "mouse", button: 2, buttons: 2 }), null);
});
