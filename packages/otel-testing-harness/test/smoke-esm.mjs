/* eslint-disable no-undef */
import { createOtelTestingHarness } from "../dist/index.mjs";

const harness = await createOtelTestingHarness({ port: 0 });
console.log(`ESM smoke test: harness listening on port ${harness.port}`);
await harness.stop();
console.log("ESM smoke test: passed");
