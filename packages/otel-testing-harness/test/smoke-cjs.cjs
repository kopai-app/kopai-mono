async function main() {
  const { createOtelTestingHarness } = require("../dist/index.cjs");

  const harness = await createOtelTestingHarness({ port: 0 });
  console.log(`CJS smoke test: harness listening on port ${harness.port}`);
  await harness.stop();
  console.log("CJS smoke test: passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
