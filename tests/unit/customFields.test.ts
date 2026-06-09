// tests/unit/customFields.test.ts
import { describe, it, expect } from "vitest";
import {
  setCustomField,
  removeCustomField,
  renameCustomField,
} from "@/lib/customFields";

describe("setCustomField", () => {
  it("adds a new key to an empty record", () => {
    const result = setCustomField({}, "score", 42);
    expect(result).toEqual({ score: 42 });
  });

  it("overwrites an existing key", () => {
    const result = setCustomField({ score: 10 }, "score", 99);
    expect(result).toEqual({ score: 99 });
  });

  it("does not mutate the original", () => {
    const original = { a: 1 };
    setCustomField(original, "b", 2);
    expect(original).toEqual({ a: 1 });
  });

  it("preserves existing keys while adding a new one", () => {
    const result = setCustomField({ a: 1, b: 2 }, "c", 3);
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("stores null as a value", () => {
    const result = setCustomField({}, "key", null);
    expect(result).toEqual({ key: null });
  });
});

describe("removeCustomField", () => {
  it("removes an existing key", () => {
    const result = removeCustomField({ a: 1, b: 2 }, "a");
    expect(result).toEqual({ b: 2 });
  });

  it("returns a copy when key does not exist", () => {
    const original = { a: 1 };
    const result = removeCustomField(original, "b");
    expect(result).toEqual({ a: 1 });
  });

  it("does not mutate the original", () => {
    const original = { a: 1, b: 2 };
    removeCustomField(original, "a");
    expect(original).toEqual({ a: 1, b: 2 });
  });

  it("handles removing from an empty record gracefully", () => {
    const result = removeCustomField({}, "nonexistent");
    expect(result).toEqual({});
  });
});

describe("renameCustomField", () => {
  it("renames an existing key, preserving the value", () => {
    const result = renameCustomField({ oldName: "hello" }, "oldName", "newName");
    expect(result).toEqual({ newName: "hello" });
  });

  it("is a no-op if newKey is blank", () => {
    const original = { a: 1 };
    expect(renameCustomField(original, "a", "")).toBe(original);
    expect(renameCustomField(original, "a", "   ")).toBe(original);
  });

  it("is a no-op if newKey already exists", () => {
    const original = { a: 1, b: 2 };
    expect(renameCustomField(original, "a", "b")).toBe(original);
  });

  it("is a no-op if oldKey does not exist", () => {
    const original = { a: 1 };
    expect(renameCustomField(original, "missing", "newKey")).toBe(original);
  });

  it("is a no-op if oldKey === newKey (trimmed)", () => {
    const original = { a: 1 };
    expect(renameCustomField(original, "a", "a")).toBe(original);
  });

  it("preserves other keys during rename", () => {
    const result = renameCustomField({ x: 10, y: 20, z: 30 }, "y", "renamed");
    expect(result).toEqual({ x: 10, renamed: 20, z: 30 });
  });

  it("does not mutate the original", () => {
    const original = { a: 1, b: 2 };
    renameCustomField(original, "a", "c");
    expect(original).toEqual({ a: 1, b: 2 });
  });
});
