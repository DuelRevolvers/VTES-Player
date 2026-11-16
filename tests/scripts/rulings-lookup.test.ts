import { describe, expect, it } from "vitest";
import { loadDatabase, lookup } from "../../scripts/rulings-lookup.mts";

const db = loadDatabase();
describe("offline rulings lookup", () => {
  it("finds direct and shared group rulings and their source links by card ID", () => {
    const result = lookup(db, "102082");
    expect(result).toContain("Unwholesome Bond");
    expect(result).toContain("ANK 20211113");
    expect(result).toContain("G00003|Circle");
    expect(result).toContain("https://www.vekn.net/forum/rules-questions/79465");
  });
  it("searches by case-insensitive partial name and resolves references", () => {
    const result = lookup(db, "sleeping MIND");
    expect(result).toContain("101805 | The Sleeping Mind");
    expect(result).toContain("Freak Drive");
    expect(result).toMatch(/PIB 20150703: https?:\/\//);
  });
  it("shows overrides and the referenced general group text", () => {
    const result = lookup(db, "101123");
    expect(result).toContain("G00080|Action targeting vampire in torpor (warunek: [for])");
    expect(result).toContain("all targets are no longer in torpor");
    expect(result).toContain("Ogólny tekst grupy");
    expect(result).toContain("ANK 20210124: https://");
  });
  it("reports a card without rulings without claiming a review", () => {
    const fake = { ...db, cards: { x: { card: { id: 999999, name: "Card With No Rulings" } } } };
    expect(lookup(fake, "999999")).toContain("brak wpisu w tej migawce");
    expect(lookup(fake, "999998")).toContain("Nie znaleziono karty");
  });
  it("rejects an empty search", () => expect(() => lookup(db, " ")).toThrow());
});
