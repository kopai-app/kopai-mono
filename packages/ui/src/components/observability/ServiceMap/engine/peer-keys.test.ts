import { describe, it, expect } from "vitest";
import {
  classifyPeer,
  isIpLiteral,
  KnownServices,
  normaliseHost,
  virtualTarget,
} from "./peer-keys.js";

const known = new KnownServices(["cart", "Checkout", "payments"]);
const none = new KnownServices();

describe("normaliseHost", () => {
  it.each([
    ["Cart:8080", "cart"],
    ["cart.default.svc.cluster.local.", "cart.default.svc.cluster.local"],
    ["API.Stripe.com:443", "api.stripe.com"],
    ["10.0.0.5:5432", "10.0.0.5"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["[::1]", "::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["  example.com.. ", "example.com"],
    ["cart:", "cart"],
  ])("%s → %s", (raw, expected) => {
    expect(normaliseHost(raw)).toBe(expected);
  });

  it("recognises IP literals", () => {
    expect(isIpLiteral("10.0.0.5")).toBe(true);
    expect(isIpLiteral("2001:db8::1")).toBe(true);
    expect(isIpLiteral("cart.default")).toBe(false);
  });
});

describe("virtualTarget priority list (R1-D3/D4/D6)", () => {
  it("peer.service wins and the db family sets the kind: db:orders-db", () => {
    expect(
      virtualTarget(
        {
          peerService: "orders-db",
          dbSystem: "postgresql",
          dbNamespace: "orders",
          serverAddress: "10.1.1.1",
        },
        known
      )
    ).toEqual({
      id: "db:orders-db",
      label: "orders-db (postgresql)",
      kind: "database",
      direction: "out",
    });
  });

  it("peer.service alone is an external node", () => {
    expect(virtualTarget({ peerService: "legacy-erp" }, known)).toMatchObject({
      id: "ext:legacy-erp",
      kind: "external",
    });
  });

  it("db.system.name with db.namespace gives db:postgresql/shop", () => {
    expect(
      virtualTarget(
        {
          dbSystem: "postgresql",
          dbNamespace: "shop",
          serverAddress: "pg.internal:5432",
        },
        known
      )
    ).toEqual({
      id: "db:postgresql/shop",
      label: "shop (postgresql)",
      kind: "database",
      direction: "out",
    });
    expect(virtualTarget({ dbSystem: "redis" }, known)?.id).toBe("db:redis");
  });

  it("messaging: publish points svc → mq, receive flips it to mq → svc, settle is ignored", () => {
    const base = {
      messagingSystem: "kafka",
      messagingDestination: "order-events",
    };
    expect(
      virtualTarget({ ...base, messagingOperation: "send" }, known)
    ).toEqual({
      id: "mq:kafka/order-events",
      label: "order-events (kafka)",
      kind: "messaging",
      direction: "out",
    });
    expect(
      virtualTarget({ ...base, messagingOperation: "receive" }, known)
        ?.direction
    ).toBe("in");
    expect(
      classifyPeer({ ...base, messagingOperation: "settle" }, known)
    ).toEqual({ type: "ignored" });
  });

  describe("server.address same-name drop (R1-D3a)", () => {
    it.each([
      "cart",
      "CART",
      "cart:8080",
      "cart.ns.svc.cluster.local",
      "cart.default.svc.cluster.local",
      "cart.default.svc.cluster.local.",
      "[cart]:80",
    ])("%s with known service cart → null", (address) => {
      expect(virtualTarget({ serverAddress: address }, known)).toBeNull();
      expect(classifyPeer({ serverAddress: address }, known).type).toBe(
        "known-service"
      );
    });

    it("matches services case-insensitively", () => {
      expect(
        virtualTarget({ serverAddress: "checkout.prod.svc" }, known)
      ).toBeNull();
    });

    it("drops a peer.service that names a known service", () => {
      expect(virtualTarget({ peerService: "payments" }, known)).toBeNull();
    });

    it("keeps a host that only contains a service name elsewhere", () => {
      expect(
        virtualTarget({ serverAddress: "my-cart.example.com" }, known)?.id
      ).toBe("ext:my-cart.example.com");
    });
  });

  it("api.stripe.com:443 gives ext:api.stripe.com", () => {
    expect(
      virtualTarget({ serverAddress: "api.stripe.com:443" }, known)
    ).toEqual({
      id: "ext:api.stripe.com",
      label: "api.stripe.com",
      kind: "external",
      direction: "out",
    });
  });

  it("10.0.0.5:5432 gives ext:10.0.0.5; an IP is never matched by its first label", () => {
    expect(virtualTarget({ serverAddress: "10.0.0.5:5432" }, known)?.id).toBe(
      "ext:10.0.0.5"
    );
    const numeric = new KnownServices(["10"]);
    expect(virtualTarget({ serverAddress: "10.0.0.5" }, numeric)?.id).toBe(
      "ext:10.0.0.5"
    );
  });

  it("no peer attributes → no-peer (counted as clientNoPeer)", () => {
    expect(classifyPeer({}, none)).toEqual({ type: "no-peer" });
    expect(
      classifyPeer({ peerService: "  ", serverAddress: null }, none)
    ).toEqual({ type: "no-peer" });
    expect(virtualTarget({}, none)).toBeNull();
  });
});
