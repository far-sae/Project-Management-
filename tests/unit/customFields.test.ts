// tests/unit/customFields.test.ts
import { describe, it, expect } from "vitest";
import {
  setCustomField,
  removeCustomField,
  renameCustomField,
  customFieldLabel,
  customFieldRows,
  newCustomFieldRow,
  readCustomFieldRows,
  knownCustomFieldKeys,
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

// The rows a person types into the "Custom fields" part of a lead form.
describe("custom field rows", () => {
  it("names a stored key the way people read it", () => {
    expect(customFieldLabel("budget_range")).toBe("Budget Range");
  });

  it("turns what is stored into one row per field", () => {
    const rows = customFieldRows({ budget_range: "£5k", industry: "Dental" });
    expect(rows.map((r) => [r.key, r.name, r.value])).toEqual([
      ["budget_range", "Budget Range", "£5k"],
      ["industry", "Industry", "Dental"],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("stores a typed name as a lowercase key and trims the value", () => {
    const rows = [{ ...newCustomFieldRow("Budget range"), value: "  £5k " }];
    expect(readCustomFieldRows(rows)).toEqual({ fields: { budget_range: "£5k" }, error: null });
  });

  it("leaves out rows with no value and rows left empty", () => {
    const rows = [newCustomFieldRow("Industry"), newCustomFieldRow(), { ...newCustomFieldRow("Size"), value: "12" }];
    expect(readCustomFieldRows(rows)).toEqual({ fields: { size: "12" }, error: null });
  });

  it("keeps the stored key of a field whose name was not changed", () => {
    const [row] = customFieldRows({ "Budget Range": "£5k" });
    expect(readCustomFieldRows([{ ...row!, value: "£8k" }]).fields).toEqual({ "Budget Range": "£8k" });
  });

  it("asks for a name when a value has none", () => {
    const result = readCustomFieldRows([{ ...newCustomFieldRow(), value: "£5k" }]);
    expect(result.error).toMatch(/name/i);
  });

  it("refuses two fields with the same name", () => {
    const result = readCustomFieldRows([
      { ...newCustomFieldRow("Budget"), value: "1" },
      { ...newCustomFieldRow("budget "), value: "2" },
    ]);
    expect(result.error).toMatch(/same name/i);
  });

  it("lists the field names already used, most used first", () => {
    expect(
      knownCustomFieldKeys([{ industry: "a", budget: "b" }, { budget: "c" }, null, undefined, {}]),
    ).toEqual(["budget", "industry"]);
  });
});
