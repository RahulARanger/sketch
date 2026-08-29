import assert from "node:assert/strict";
import test from "node:test";
import { getToolShortcut, shouldSkipShortcut } from "../src/keyboardShortcuts.ts";

const plainKey = { defaultPrevented: false, isComposing: false, metaKey: false, ctrlKey: false };

test("plain typing in an editable field skips canvas shortcuts", () => {
  assert.equal(shouldSkipShortcut(plainKey, true), true);
});

test("modified shortcuts remain available while editing", () => {
  assert.equal(shouldSkipShortcut({ ...plainKey, metaKey: true }, true), false);
  assert.equal(shouldSkipShortcut({ ...plainKey, ctrlKey: true }, true), false);
});

test("composed or already-handled key events are ignored", () => {
  assert.equal(shouldSkipShortcut({ ...plainKey, isComposing: true }, false), true);
  assert.equal(shouldSkipShortcut({ ...plainKey, defaultPrevented: true }, false), true);
});

test("accepts the Wacom eraser shortcut name as well as E", () => {
  assert.equal(getToolShortcut({ key: "e", code: "KeyE" }), "eraser");
  assert.equal(getToolShortcut({ key: "Eraser", code: "Unidentified" }), "eraser");
});
