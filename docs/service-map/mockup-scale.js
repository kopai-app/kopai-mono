/* global document, window, performance, addEventListener */
// Reference implementation of layout D for docs/service-map/mockup-layouts.html.
(function () {
  const S = 5;
  const SVGNS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const radius = (n) =>
    n.type === "svc"
      ? Math.max(5, 6 + 3.4 * Math.log10(Math.max(n.spans, 20) / 200))
      : 9;
  const width = (c) => Math.max(0.8, 0.8 + 1.25 * Math.log10(c / 500));
  const short = (s) => (s.length > 21 ? s.slice(0, 20) + "…" : s);
  function rng(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- example systems ----------
  function genSystem(nSvc, seed) {
    const r = rng(seed),
      pick = (a) => a[Math.floor(r() * a.length)];
    const W1 = [
      "order",
      "cart",
      "user",
      "payment",
      "shipment",
      "stock",
      "price",
      "promo",
      "review",
      "search",
      "recs",
      "media",
      "auth",
      "tax",
      "fraud",
      "loyalty",
      "invoice",
      "refund",
      "notify",
      "geo",
      "catalog",
      "vendor",
      "ledger",
      "quote",
      "route",
      "label",
      "audit",
      "consent",
      "session",
      "profile",
      "wallet",
      "coupon",
      "return",
      "warehouse",
      "courier",
      "rating",
      "feed",
      "chat",
      "report",
      "billing",
      "plan",
      "quota",
      "export",
      "import",
      "image",
      "pdf",
      "sms",
      "email",
      "ab-test",
      "pricing",
    ];
    const W2 = [
      "-svc",
      "-api",
      "-worker",
      "-core",
      "-reader",
      "-writer",
      "-gw",
      "-engine",
      "-store",
      "-proxy",
    ];
    const hub = "edge-gateway";
    const ups =
      nSvc > 50
        ? ["web-app", "mobile-bff", "partner-api", "admin-console"]
        : ["web-app", "mobile-bff"];
    const used = new Set([hub, ...ups]);
    const nm = () => {
      for (let i = 0; i < 80; i++) {
        const n = pick(W1) + pick(W2);
        if (!used.has(n)) {
          used.add(n);
          return n;
        }
      }
      const n = "svc-" + used.size;
      used.add(n);
      return n;
    };
    const nodes = [],
      E = new Map();
    const edge = (s, t, calls, stage) => {
      if (s === t) return;
      const k = s + ">" + t;
      if (!E.has(k))
        E.set(k, {
          s,
          t,
          calls: Math.max(5, Math.round(calls)),
          stage,
          key: k,
        });
    };
    const nDom = Math.max(1, nSvc - 1 - ups.length);
    const dom = Array.from({ length: nDom }, nm);
    const all = [hub, ...ups, ...dom],
      spans = {};
    all.forEach(
      (id, i) =>
        (spans[id] = Math.round(
          (90000 / Math.pow(1 + i, 0.8)) * (0.7 + 0.6 * r())
        ))
    );
    spans[hub] = Math.max(...Object.values(spans)) + 5000;
    all.forEach((id) => nodes.push({ id, type: "svc", spans: spans[id] }));
    const nFront = Math.max(3, Math.round(nDom * 0.15));
    const nIso = Math.max(1, Math.round(nDom * 0.03)),
      nWork = Math.max(1, Math.round(nDom * 0.08));
    const workers = dom.slice(nDom - nIso - nWork, nDom - nIso),
      iso = dom.slice(nDom - nIso);
    ups.forEach((u) => edge(u, hub, spans[u] * 0.8, 1));
    ups
      .slice(1)
      .forEach((u) => edge(u, pick(dom.slice(0, nFront)), spans[u] * 0.2, 1));
    dom.forEach((s, i) => {
      if (workers.includes(s) || iso.includes(s)) return;
      if (i < nFront) {
        edge(hub, s, spans[s] * 0.6, 0);
        return;
      }
      edge(dom[Math.floor(i * Math.pow(r(), 1.6))], s, spans[s] * 0.5, 0);
      if (r() < 0.25) edge(dom[Math.floor(i * r())], s, spans[s] * 0.2, 0);
    });
    const virt = (prefix, n, type, lab) =>
      Array.from({ length: n }, (_, i) => {
        const id = prefix + i;
        nodes.push({ id, type, spans: 0, label: lab() });
        return id;
      });
    const dbs = virt(
      "db",
      Math.max(2, Math.round(nSvc * 0.12)),
      "db",
      () => pick(["postgres", "mysql", "mongodb"]) + " · " + pick(W1)
    );
    const caches = virt(
      "cache",
      Math.max(1, Math.round(nSvc * 0.02)),
      "db",
      () => "redis · " + pick(W1)
    );
    const qs = virt(
      "q",
      Math.max(1, Math.round(nSvc * 0.03)),
      "queue",
      () => "kafka · " + pick(W1) + "-events"
    );
    const exts = [
      "api.stripe.com",
      "api.twilio.com",
      "maps.googleapis.com",
      "api.sendgrid.com",
      "s3.amazonaws.com",
    ]
      .slice(0, nSvc > 50 ? 5 : 3)
      .map((x) => {
        nodes.push({ id: "x:" + x, type: "ext", spans: 0, label: x });
        return "x:" + x;
      });
    const zipf = (a) =>
      a[Math.min(a.length - 1, Math.floor(a.length * Math.pow(r(), 2)))];
    dom.forEach((s) => {
      if (iso.includes(s)) {
        if (r() < 0.5) edge(s, zipf(dbs), spans[s] * 0.9, 1);
        return;
      }
      if (r() < 0.6) edge(s, zipf(dbs), spans[s] * 0.7, 1);
      if (r() < 0.2) edge(s, pick(caches), spans[s] * 0.9, 1);
      if (r() < 0.1) edge(s, pick(qs), spans[s] * 0.3, 1);
      if (r() < 0.06) edge(s, pick(exts), spans[s] * 0.2, 1);
    });
    workers.forEach((w) => {
      edge(pick(qs), w, spans[w] * 0.8, 1);
      if (r() < 0.5) edge(w, zipf(dbs), spans[w] * 0.5, 1);
    });
    qs.forEach((q) => {
      if (![...E.values()].some((e) => e.t === q))
        edge(pick(dom.slice(0, nFront)), q, 500, 1);
    });
    const late = [...E.values()]
      .filter((e) => e.stage === 0)
      .sort((a, b) => b.calls - a.calls);
    late.forEach(
      (e, i) =>
        (e.stage =
          1 +
          Math.min(4, Math.floor((i / late.length) * 5 * (0.6 + 0.8 * r()))))
    );
    const touched = new Set();
    E.forEach((e) => {
      touched.add(e.s);
      touched.add(e.t);
    });
    return {
      nodes: nodes.filter((n) => n.type === "svc" || touched.has(n.id)),
      edges: [...E.values()],
    };
  }
  function chain(n) {
    const ids = Array.from(
      { length: n },
      (_, i) => "step-" + String(i + 1).padStart(2, "0")
    );
    const mid = Math.floor(n / 2);
    return {
      nodes: ids.map((id, i) => ({
        id,
        type: "svc",
        spans: 22000 - Math.abs(i - mid) * 1300,
      })),
      edges: ids
        .slice(1)
        .map((id, i) => ({
          s: ids[i],
          t: id,
          calls: 9000,
          stage: 1 + Math.min(4, Math.floor(Math.abs(i + 0.5 - mid) / 1.5)),
          key: ids[i] + ">" + id,
        })),
    };
  }
  function star(n) {
    const r = rng(5),
      nodes = [
        { id: "api-gateway", type: "svc", spans: 95000 },
        { id: "web-app", type: "svc", spans: 60000 },
      ],
      edges = [];
    const dbs = [
      "postgres · main",
      "postgres · events",
      "redis · cache",
      "mongodb · docs",
    ].map((l, i) => {
      nodes.push({ id: "db" + i, type: "db", spans: 0, label: l });
      return "db" + i;
    });
    edges.push({
      s: "web-app",
      t: "api-gateway",
      calls: 50000,
      stage: 1,
      key: "w",
    });
    for (let i = 0; i < n; i++) {
      const id = "fn-" + String(i + 1).padStart(3, "0");
      const spans = Math.round(30000 / Math.pow(i + 1, 0.7));
      nodes.push({ id, type: "svc", spans });
      edges.push({
        s: "api-gateway",
        t: id,
        calls: spans * 0.8,
        stage: 1 + Math.min(4, Math.floor((i / n) * 5)),
        key: "g" + i,
      });
      if (r() < 0.5)
        edges.push({
          s: id,
          t: dbs[Math.floor(r() * 4)],
          calls: spans * 0.5,
          stage: 1,
          key: "d" + i,
        });
    }
    return { nodes, edges };
  }
  const shop = () => ({
    nodes: window.__shop.NODES,
    edges: window.__shop.EDGES,
  });

  const SCN = [
    {
      key: "empty",
      label: "Empty",
      g: () => ({ nodes: [], edges: [] }),
      note: "No spans in the past 60 minutes. The map shows an empty state that says what to do next, never a blank canvas.",
    },
    {
      key: "one",
      label: "1 service",
      g: () => ({
        nodes: [{ id: "my-app", type: "svc", spans: 4200 }],
        edges: [],
      }),
      note: "One service with no outgoing calls, the typical first run. It sits in the centre at normal size: fitting the view never zooms past 100%, so a single node never fills the screen.",
    },
    {
      key: "onedb",
      label: "1 service + DBs",
      g: () => ({
        nodes: [
          { id: "my-app", type: "svc", spans: 4200 },
          { id: "pg", type: "db", spans: 0, label: "postgres · app" },
          { id: "rd", type: "db", spans: 0, label: "redis · cache" },
          { id: "oa", type: "ext", spans: 0, label: "api.openai.com" },
        ],
        edges: [
          { s: "my-app", t: "pg", calls: 3100, stage: 1, key: "a" },
          { s: "my-app", t: "rd", calls: 2600, stage: 1, key: "b" },
          { s: "my-app", t: "oa", calls: 240, stage: 1, key: "c" },
        ],
      }),
      note: "One service and the things it calls, all known from the aggregate query on frame 1.",
    },
    {
      key: "two",
      label: "2, not connected",
      g: () => ({
        nodes: [
          { id: "api", type: "svc", spans: 5200 },
          { id: "nightly-export", type: "svc", spans: 300 },
        ],
        edges: [],
      }),
      note: "Neither service calls the other, so the one with more spans takes the centre. The other stays in the tray for the whole session, which is the honest answer.",
    },
    {
      key: "chain",
      label: "Deep chain (15)",
      g: () => chain(15),
      note: "Each service calls the next. The busiest sits mid-chain, so callers go left and callees right. The map gets wide, not tall.",
    },
    {
      key: "shop",
      label: "Shop (20)",
      g: shop,
      note: "The example system from the panels above.",
    },
    {
      key: "star",
      label: "Star (150 callees)",
      g: () => star(150),
      note: "The worst case for column height: one gateway calling 150 functions. Column 1 wraps into lanes, so it stays a block instead of a 10,000 px tower. Labels hide at full view; zoom or search to read them.",
    },
    {
      key: "m120",
      label: "120 services",
      g: () => genSystem(120, 42),
      note: "A generated system with gateways, domain services, workers on queues, shared databases, a few external APIs and isolated cron jobs. Some cron jobs never connect and stay in the tray.",
    },
    {
      key: "m400",
      label: "400 services",
      g: () => genSystem(400, 7),
      note: 'The same generator at 400 services, about 480 nodes in total. Use Find to jump to a service, for example "edge-gateway" or a database.',
    },
  ];

  // ---------- layout D with lanes ----------
  function computeFlow(G) {
    const t0 = performance.now();
    const nodes = G.nodes,
      N = nodes.length;
    if (!N)
      return {
        frames: Array.from({ length: S }, () => ({})),
        hub: null,
        ms: 0,
        K: 0,
        maxLanes: 0,
      };
    const conn = new Set();
    G.edges
      .filter((e) => e.stage <= 1)
      .forEach((e) => {
        conn.add(e.s);
        conn.add(e.t);
      });
    const svc = nodes.filter((n) => n.type === "svc");
    const pool = svc.filter((n) => conn.has(n.id));
    const cands = pool.length ? pool : svc.length ? svc : nodes;
    const hub = cands.reduce((a, b) =>
      (b.spans || 0) > (a.spans || 0) ? b : a
    ).id;
    const K = Math.max(6, Math.min(14, Math.ceil(Math.sqrt(N))));
    const lo = -Math.floor((K - 1) / 2),
      hi = lo + K - 1;
    const ROW = 64,
      LANE = 170,
      GAP = 50;
    const lanes = {},
      slot = {},
      occ = {};
    const occSet = (c, l) => occ[c + ":" + l] || (occ[c + ":" + l] = new Set());
    function place(id, c, dRow) {
      const L = lanes[c] || (lanes[c] = 1);
      let best = null,
        bs = Infinity;
      for (let l = 0; l < L; l++)
        for (let r = lo; r <= hi; r++) {
          if (occSet(c, l).has(r)) continue;
          const sc = Math.abs(r - dRow) + l * 2.5;
          if (sc < bs) {
            bs = sc;
            best = [l, r];
          }
        }
      if (!best) {
        lanes[c] = L + 1;
        best = [L, Math.max(lo, Math.min(hi, dRow))];
      }
      occSet(c, best[0]).add(best[1]);
      slot[id] = { c, l: best[0], r: best[1] };
    }
    function bfs(start, next) {
      const d = { [start]: 0 },
        q = [start];
      for (let i = 0; i < q.length; i++)
        for (const v of next[q[i]] || [])
          if (d[v] == null) {
            d[v] = d[q[i]] + 1;
            q.push(v);
          }
      return d;
    }
    function xOf(c, l) {
      if (c === 0) return l * LANE;
      if (c > 0) {
        let right = ((lanes[0] || 1) - 1) * LANE + LANE / 2,
          left = 0;
        for (let k = 1; k <= c; k++) {
          left = right + GAP;
          right = left + (lanes[k] || 0) * LANE;
        }
        return left + LANE / 2 + l * LANE;
      }
      let left = -LANE / 2,
        right = 0;
      for (let k = -1; k >= c; k--) {
        right = left - GAP;
        left = right - (lanes[k] || 0) * LANE;
      }
      return right - LANE / 2 - l * LANE;
    }
    const frames = [];
    for (let st = 1; st <= S; st++) {
      const es = G.edges.filter((e) => e.stage <= st);
      const adj = {},
        outE = {},
        inE = {};
      nodes.forEach((n) => (adj[n.id] = []));
      es.forEach((e) => {
        adj[e.s].push({ n: e.t, calls: e.calls, out: true });
        adj[e.t].push({ n: e.s, calls: e.calls, out: false });
        (outE[e.s] = outE[e.s] || []).push(e.t);
        (inE[e.t] = inE[e.t] || []).push(e.s);
      });
      Object.values(adj).forEach((a) => a.sort((x, y) => y.calls - x.calls));
      const order = [hub],
        seen = new Set([hub]);
      for (let i = 0; i < order.length; i++)
        for (const { n } of adj[order[i]])
          if (!seen.has(n)) {
            seen.add(n);
            order.push(n);
          }
      const down = bfs(hub, outE),
        up = bfs(hub, inE);
      for (const id of order) {
        if (slot[id]) continue;
        if (id === hub) {
          lanes[0] = 1;
          occSet(0, 0).add(0);
          slot[id] = { c: 0, l: 0, r: 0 };
          continue;
        }
        const placed = adj[id].filter((p) => slot[p.n]);
        const par = placed[0];
        let c;
        if (down[id] != null) c = down[id];
        else if (up[id] != null) c = -up[id];
        else c = par.out ? slot[par.n].c - 1 : slot[par.n].c + 1;
        const near = placed.find((p) => Math.abs(slot[p.n].c - c) === 1) || par;
        place(id, c, slot[near.n].r);
      }
      const f = {};
      order.forEach((id) => {
        const s = slot[id];
        f[id] = { x: xOf(s.c, s.l), y: s.r * ROW };
      });
      frames.push(f);
    }
    return {
      frames,
      hub,
      ms: performance.now() - t0,
      K,
      maxLanes: Math.max(...Object.values(lanes)),
    };
  }

  // ---------- rendering ----------
  const box = document.getElementById("scaleBox"),
    checks = document.getElementById("checks");
  const find = document.getElementById("find"),
    findList = document.getElementById("findList");
  let G,
    R,
    NM,
    st = S,
    svg,
    vb,
    fit,
    nodeEls = {},
    edgeEls = [],
    foundId = null,
    scnKey = "shop";

  function bboxAll() {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    R.frames.forEach((f) =>
      Object.values(f).forEach((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      })
    );
    return {
      minX: minX - 100,
      maxX: maxX + 100,
      minY: minY - 40,
      maxY: maxY + 40,
    };
  }
  function trayLayout(frame, bb) {
    const ids = G.nodes.map((n) => n.id).filter((id) => !frame[id]);
    const perRow = Math.max(1, Math.floor((bb.maxX - bb.minX - 40) / 160));
    const top = bb.maxY + 70,
      out = {};
    ids.forEach(
      (id, i) =>
        (out[id] = {
          x: bb.minX + 40 + 160 * (i % perRow) + 70,
          y: top + 10 + Math.floor(i / perRow) * 54,
        })
    );
    return { ids, out, top, rows: Math.ceil(ids.length / perRow), perRow };
  }
  function scale() {
    return svg ? Math.min(svg.clientWidth / vb.w, svg.clientHeight / vb.h) : 1;
  }
  function applyVB() {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const px = 11.5 * scale();
    svg.classList.toggle("lod", px < 7.5);
    const lab = document.getElementById("labelChip");
    if (lab) {
      lab.className = "chip " + (px < 7.5 ? "info" : "ok");
      lab.textContent =
        px < 7.5
          ? `Labels hidden at this zoom (${px.toFixed(1)} px); hover, find or zoom in`
          : `Labels readable (${px.toFixed(1)} px)`;
    }
  }
  function render() {
    box.replaceChildren();
    nodeEls = {};
    edgeEls = [];
    svg = el(
      "svg",
      {
        class: "map",
        role: "img",
        "aria-label": "Layout D on the selected example system",
      },
      box
    );
    if (!G.nodes.length) {
      vb = fit = { x: 0, y: 0, w: 1000, h: 460 };
      el("text", { x: 500, y: 210, class: "empty-title" }, svg).textContent =
        "No traces in the past 60 minutes";
      el("text", { x: 500, y: 242, class: "empty-msg" }, svg).textContent =
        "Send OpenTelemetry traces to Kopai and services appear here as soon as spans arrive.";
      applyVB();
      return;
    }
    const frame = R.frames[st - 1],
      bb = bboxAll();
    let maxTrayRows = 0;
    R.frames.forEach(
      (f) => (maxTrayRows = Math.max(maxTrayRows, trayLayout(f, bb).rows))
    );
    const tray = trayLayout(frame, bb);
    let w = bb.maxX - bb.minX,
      h = bb.maxY - bb.minY + (maxTrayRows ? 70 + maxTrayRows * 54 + 20 : 0);
    let x = bb.minX,
      y = bb.minY;
    const cw = svg.clientWidth || 1000,
      ch = svg.clientHeight || 560;
    const minW = cw,
      minH = ch; // never zoom past 100% when fitting
    if (w < minW) {
      x -= (minW - w) / 2;
      w = minW;
    }
    if (h < minH) {
      y -= (minH - h) / 2;
      h = minH;
    }
    const aspect = cw / ch;
    if (w / h > aspect) {
      const nh = w / aspect;
      y -= (nh - h) / 2;
      h = nh;
    } else {
      const nw = h * aspect;
      x -= (nw - w) / 2;
      w = nw;
    }
    fit = { x, y, w, h };
    if (!vb || vb.key !== scnKey) vb = { ...fit, key: scnKey };
    svg.style.setProperty("--edge-op", G.nodes.length > 60 ? ".45" : ".9");

    const id = "sc";
    const defs = el("defs", {}, svg);
    for (const [name, cls] of [
      ["a", "arrow"],
      ["h", "arrow-hl"],
    ]) {
      const m = el(
        "marker",
        {
          id: id + name,
          viewBox: "0 0 10 10",
          refX: "9",
          refY: "5",
          markerWidth: "8",
          markerHeight: "8",
          markerUnits: "userSpaceOnUse",
          orient: "auto-start-reverse",
        },
        defs
      );
      el("path", { d: "M0,1 L10,5 L0,9 z", class: cls }, m);
    }
    if (tray.ids.length) {
      el(
        "rect",
        {
          x: bb.minX + 12,
          y: tray.top - 30,
          width: bb.maxX - bb.minX - 24,
          height: tray.rows * 54 + 44,
          rx: 8,
          class: "tray-band",
        },
        svg
      );
      el(
        "text",
        { x: bb.minX + 26, y: tray.top - 12, class: "guide-label" },
        svg
      ).textContent = `Not connected to the map yet · ${tray.ids.length}`;
    }
    const pos = Object.assign({}, tray.out, frame);
    const gE = el("g", {}, svg),
      gT = el("g", {}, svg),
      gN = el("g", {}, svg);
    G.edges.forEach((e) => {
      if (e.stage > st || !frame[e.s] || !frame[e.t]) return;
      const a = pos[e.s],
        b = pos[e.t];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(Math.hypot(dx, dy), 1);
      const ra = radius(NM[e.s]) + 3,
        rb = radius(NM[e.t]) + 4;
      const ln = el(
        "line",
        {
          x1: a.x + (dx / d) * ra,
          y1: a.y + (dy / d) * ra,
          x2: b.x - (dx / d) * rb,
          y2: b.y - (dy / d) * rb,
          class: "edge on",
          "stroke-width": width(e.calls),
          "marker-end": `url(#${id}a)`,
        },
        gE
      );
      edgeEls.push({ e, ln });
    });
    if (st > 1) {
      const pf = R.frames[st - 2];
      for (const k in pf)
        if (
          frame[k] &&
          Math.hypot(frame[k].x - pf[k].x, frame[k].y - pf[k].y) > 1
        ) {
          el(
            "line",
            {
              x1: pf[k].x,
              y1: pf[k].y,
              x2: frame[k].x,
              y2: frame[k].y,
              class: "trail",
            },
            gT
          );
          el(
            "circle",
            { cx: pf[k].x, cy: pf[k].y, r: 4, class: "trail-dot" },
            gT
          );
        }
    }
    G.nodes.forEach((n) => {
      const p = pos[n.id],
        r = radius(n);
      const g = el(
        "g",
        {
          class:
            "node " +
            (n.type === "svc" ? "svc" : "virt") +
            (n.type === "ext" ? " ext" : "") +
            (n.err > 1 ? " err" : "") +
            (n.id === R.hub ? " hub" : "") +
            (frame[n.id] ? "" : " tray") +
            (n.id === foundId ? " found" : ""),
          transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`,
          tabindex: "0",
        },
        gN
      );
      if (n.type === "db")
        el(
          "rect",
          { x: -r, y: -r, width: 2 * r, height: 2 * r, rx: 3, class: "shape" },
          g
        );
      else if (n.type === "queue")
        el(
          "polygon",
          {
            points: `0,${-r - 2} ${r + 2},0 0,${r + 2} ${-r - 2},0`,
            class: "shape",
          },
          g
        );
      else el("circle", { r, class: "shape" }, g);
      el("text", { y: r + 14, class: "label" }, g).textContent = short(
        n.label || n.id
      );
      el("title", {}, g).textContent =
        (n.label || n.id) +
        (n.type === "svc"
          ? `\n${n.spans.toLocaleString("en-US")} spans in the past 60 min`
          : "");
      const on = () => hover(n.id),
        off = () => hover(null);
      g.addEventListener("mouseenter", on);
      g.addEventListener("mouseleave", off);
      g.addEventListener("focus", on);
      g.addEventListener("blur", off);
      nodeEls[n.id] = g;
    });
    applyVB();
    wire();
  }
  function hover(nid) {
    const rel = new Set(nid ? [nid] : []);
    edgeEls.forEach(({ e, ln }) => {
      const hl = nid && (e.s === nid || e.t === nid);
      if (hl) {
        rel.add(e.s);
        rel.add(e.t);
      }
      ln.setAttribute(
        "class",
        "edge on" + (nid && !hl ? " dim" : "") + (hl ? " hl" : "")
      );
      ln.setAttribute("marker-end", `url(#sc${hl ? "h" : "a"})`);
    });
    for (const k in nodeEls) {
      nodeEls[k].classList.toggle("rel", rel.has(k));
      nodeEls[k].classList.toggle("dimmed", !!nid && !rel.has(k));
    }
  }
  function wire() {
    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        zoom(Math.exp(e.deltaY * 0.0015), p);
      },
      { passive: false }
    );
    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, s: scale() };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("dragging");
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      vb.x = drag.vx - (e.clientX - drag.x) / drag.s;
      vb.y = drag.vy - (e.clientY - drag.y) / drag.s;
      applyVB();
    });
    const end = () => {
      drag = null;
      svg.classList.remove("dragging");
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }
  function zoom(f, p) {
    if (!vb) return;
    p = p || { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 };
    const nw = Math.max(180, Math.min(fit.w * 1.5, vb.w * f)),
      k = nw / vb.w;
    vb.x = p.x - (p.x - vb.x) * k;
    vb.y = p.y - (p.y - vb.y) * k;
    vb.w = nw;
    vb.h = vb.h * k;
    applyVB();
  }
  document.getElementById("zin").onclick = () => zoom(0.7);
  document.getElementById("zout").onclick = () => zoom(1 / 0.7);
  document.getElementById("zfit").onclick = () => {
    vb = { ...fit, key: scnKey };
    applyVB();
  };
  function doFind() {
    const q = find.value.trim().toLowerCase();
    if (!q || !G.nodes.length) return;
    const n =
      G.nodes.find((n) => (n.label || n.id).toLowerCase() === q) ||
      G.nodes.find((n) => (n.label || n.id).toLowerCase().includes(q));
    if (!n) return;
    foundId = n.id;
    render();
    const tf = nodeEls[n.id].transform.baseVal.consolidate().matrix;
    const w = Math.min(fit.w, 900),
      h = (w * fit.h) / fit.w;
    vb = { x: tf.e - w / 2, y: tf.f - h / 2, w, h, key: scnKey };
    applyVB();
  }
  find.addEventListener("change", doFind);
  find.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doFind();
  });

  function runChecks() {
    const N = G.nodes.length,
      f = R.frames[S - 1],
      ids = Object.keys(f);
    let overlaps = 0,
      nan = 0,
      moves = 0,
      maxMove = 0;
    ids.forEach((a) => {
      if (!isFinite(f[a].x) || !isFinite(f[a].y)) nan++;
    });
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const p = f[ids[i]],
          q = f[ids[j]];
        if (Math.abs(p.x - q.x) < 40 && Math.abs(p.y - q.y) < 40) overlaps++;
      }
    for (let s = 1; s < S; s++)
      for (const k in R.frames[s - 1]) {
        const a = R.frames[s - 1][k],
          b = R.frames[s][k];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > 1) {
          moves++;
          maxMove = Math.max(maxMove, d);
        }
      }
    const tray = N - ids.length;
    const chip = (ok, text, cls) =>
      `<span class="chip ${cls || (ok ? "ok" : "warn")}">${text}</span>`;
    checks.innerHTML = [
      chip(true, `${N} nodes · ${G.edges.length} connections`, "info"),
      N ? chip(true, `Centre: ${R.hub}`, "info") : "",
      chip(!nan, nan ? `${nan} invalid positions` : "No invalid positions"),
      chip(
        !overlaps,
        overlaps ? `${overlaps} overlapping nodes` : "No overlapping nodes"
      ),
      chip(
        !moves,
        moves
          ? `${moves} moves when lanes were added, up to ${Math.round(maxMove)} px`
          : "Nothing moved across 5 steps"
      ),
      chip(
        true,
        tray
          ? `${tray} never connected (stay in tray)`
          : "Tray empty at the end",
        "info"
      ),
      N
        ? chip(
            true,
            `${R.K} rows per lane · widest column ${R.maxLanes} lane${R.maxLanes > 1 ? "s" : ""}`,
            "info"
          )
        : "",
      chip(R.ms < 50, `Layout ${R.ms.toFixed(1)} ms for all 5 steps`),
      N ? '<span class="chip ok" id="labelChip"></span>' : "",
    ].join("");
  }

  const scnEl = document.getElementById("scn"),
    stEl = document.getElementById("scnStage");
  const scnBtns = SCN.map((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = "scn-" + s.key;
    b.textContent = s.label;
    b.onclick = () => load(s.key);
    scnEl.appendChild(b);
    return b;
  });
  const stBtns = ["Frame 1", "Page 3", "Page 12", "Page 41", "Done"].map(
    (l, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "scnst" + (i + 1);
      b.textContent = l;
      b.onclick = () => {
        st = i + 1;
        stBtns.forEach((x, j) =>
          x.setAttribute("aria-pressed", String(j === i))
        );
        render();
      };
      stEl.appendChild(b);
      return b;
    }
  );
  function load(key) {
    const s = SCN.find((x) => x.key === key);
    scnKey = key;
    foundId = null;
    vb = null;
    find.value = "";
    G = s.g();
    NM = Object.fromEntries(G.nodes.map((n) => [n.id, n]));
    R = computeFlow(G);
    scnBtns.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.id === "scn-" + key))
    );
    st = S;
    stBtns.forEach((x, j) =>
      x.setAttribute("aria-pressed", String(j === S - 1))
    );
    findList.innerHTML = G.nodes
      .map(
        (n) =>
          `<option value="${(n.label || n.id).replace(/"/g, "&quot;")}"></option>`
      )
      .join("");
    document.getElementById("scnNote").textContent = s.note;
    runChecks();
    render();
  }
  window.__scaleTest = { SCN, computeFlow };
  load("star");
  addEventListener("resize", () => {
    if (G) {
      vb = null;
      render();
    }
  });
})();
