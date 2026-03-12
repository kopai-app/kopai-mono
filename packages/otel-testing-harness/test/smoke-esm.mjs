/* eslint-disable no-undef */
import { createOtelTestingHarness } from "../dist/index.mjs";

try {
  const harness = await createOtelTestingHarness({ port: 0 });
  console.log(`ESM smoke test: harness listening on port ${harness.port}`);
  await harness.stop();
  console.log("ESM smoke test: passed");
} catch (err) {
  console.error("ESM smoke test failed:", err);
  process.exit(1);
}
