/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { fixtureFrames } from "../layout/fixtures.js";
import { updateLayout } from "../layout/layout-d.js";
import { FindBox, findMatches, type FindItem } from "./FindBox.js";

/** Find items for shop20 frame 1, exactly as the canvas builds them. */
function shopItems(): { items: FindItem[]; trayIds: Set<string> } {
  const frame = fixtureFrames("shop20")[0]!;
  const layout = updateLayout(null, frame);
  const trayIds = new Set(layout.tray.ids);
  const items = frame.nodes.map((n) => {
    const p = layout.positions.get(n.id) ?? layout.tray.positions.get(n.id);
    if (!p) throw new Error(`no position for ${n.id}`);
    return {
      id: n.id,
      label: n.label ?? n.id,
      kind: n.kind,
      x: p.x,
      y: p.y,
      inTray: trayIds.has(n.id),
    };
  });
  return { items, trayIds };
}

describe("FindBox", () => {
  it("lists full names (CSS truncates them) and turns spellcheck off", () => {
    const long = "payments-reconciliation-worker";
    const items: FindItem[] = [
      { id: long, label: long, kind: "service", x: 0, y: 0, inTray: false },
    ];
    render(<FindBox items={items} onFind={() => {}} width={200} />);
    const input = screen.getByRole("combobox", { name: "Find a service" });
    expect(input.getAttribute("spellcheck")).toBe("false");
    fireEvent.change(input, { target: { value: "recon" } });
    const option = screen.getByRole("option");
    expect(option.textContent).toBe(`${long}service`);
    expect((input.closest(".sm-find") as HTMLElement).style.width).toBe(
      "200px"
    );
  });

  it("finds a tray node by substring and centres on its tray position", () => {
    const { items, trayIds } = shopItems();
    expect(trayIds.has("checkout")).toBe(true);
    const onFind = vi.fn();
    render(<FindBox items={items} onFind={onFind} />);
    const input = screen.getByRole("combobox", { name: "Find a service" });
    fireEvent.change(input, { target: { value: "ckou" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "checkoutservice · not connected",
    ]);
    fireEvent.mouseDown(options[0]!);
    const checkout = items.find((i) => i.id === "checkout")!;
    expect(onFind).toHaveBeenCalledTimes(1);
    expect(onFind).toHaveBeenCalledWith(
      expect.objectContaining({ id: "checkout", x: checkout.x, y: checkout.y })
    );
    expect(checkout.y).toBeGreaterThan(0); // the tray sits below the map
  });

  it("finds a database node by a substring of its label, with Enter", () => {
    const { items } = shopItems();
    const onFind = vi.fn();
    render(<FindBox items={items} onFind={onFind} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ORDERS" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    const pg = items.find((i) => i.id === "postgres")!;
    expect(pg.kind).toBe("database");
    expect(onFind).toHaveBeenCalledWith(
      expect.objectContaining({ id: "postgres", x: pg.x, y: pg.y })
    );
    expect((input as HTMLInputElement).value).toBe("postgres · orders");
  });

  it("ranks exact, then prefix, then substring matches, and searches ids too", () => {
    const item = (id: string, label = id): FindItem => ({
      id,
      label,
      kind: "service",
      x: 0,
      y: 0,
      inTray: false,
    });
    const items = [
      item("my-cart"),
      item("cart-worker"),
      item("cart"),
      item("db:redis/cart", "redis · sessions"),
      item("users"),
    ];
    expect(findMatches(items, "cart").map((i) => i.id)).toEqual([
      "cart",
      "cart-worker",
      // substring matches, by label: "my-cart" < "redis · sessions"
      "my-cart",
      "db:redis/cart",
    ]);
    expect(findMatches(items, "  ")).toEqual([]);
    expect(findMatches(items, "zzz")).toEqual([]);
    expect(findMatches(items, "r", 2)).toHaveLength(2);
  });

  it("moves through results with the arrow keys and shows 'No match'", () => {
    const { items } = shopItems();
    const onFind = vi.fn();
    const onClear = vi.fn();
    render(<FindBox items={items} onFind={onFind} onClear={onClear} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "pay" } });
    // "payments" only; then "s" matches many
    fireEvent.change(input, { target: { value: "se" } });
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels.length).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFind).toHaveBeenCalledTimes(1);
    const chosen = onFind.mock.calls[0]![0] as FindItem;
    expect(findMatches(items, "se")[1]!.id).toBe(chosen.id);

    fireEvent.change(input, { target: { value: "nothing-like-this" } });
    expect(screen.getByText("No match")).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    expect(onClear).toHaveBeenCalled();
  });
});
