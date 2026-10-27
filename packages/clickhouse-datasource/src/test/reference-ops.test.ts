import { describe, it } from "vitest";
import { expectRowsClose } from "./distribution-harness.js";
import { GOLDEN_CASES, type GoldenCase } from "./golden-cases.js";
import { referenceAggregate } from "./reference-ops.js";

describe("reference implementation: golden cases (spec 9.1)", () => {
  it.each(GOLDEN_CASES.map((c): [string, GoldenCase] => [c.id, c]))(
    "%s",
    (id, c) => {
      expectRowsClose(referenceAggregate(c.input), c.expected, id);
    }
  );
});
