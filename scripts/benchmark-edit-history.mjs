import assert from "node:assert/strict";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { Text } from "@codemirror/state";
import { createServer } from "vite";

const [, , scenario, verify] = process.argv;
if (!["typing", "paste", "repeat", "distinct"].includes(scenario) || !globalThis.gc) {
  throw new Error("Run node --expose-gc scripts/benchmark-edit-history.mjs <typing|paste|repeat|distinct> [--verify]");
}

const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false },
});
try {
  const historyApi = await server.ssrLoadModule("/src/lib/editHistory.ts");
  const documentApi = await server.ssrLoadModule("/src/lib/document.ts");
  const result = run(historyApi, documentApi);
  result.memoryBytes.released = memory();
  console.log(JSON.stringify(result));
  if (verify === "--verify") {
    const { baseline, edited, branched } = result.memoryBytes;
    const retained = (point) => point.heapUsed + point.external - baseline.heapUsed - baseline.external;
    if (scenario === "paste") assert(retained(edited) < 48 * 2 ** 20, "Small patches retained their source documents");
    if (scenario === "repeat") assert(retained(edited) < 96 * 2 ** 20, "Identical attachments were retained more than once");
    if (branched) assert(retained(branched) < 32 * 2 ** 20, "Discarded redo entries retained attachment payloads");
  }
} finally {
  await server.close();
}

function memory() {
  // Collect twice so external buffers freed by the first collection are reflected in the counters.
  globalThis.gc();
  globalThis.gc();
  const { heapUsed, external, rss } = process.memoryUsage();
  return { heapUsed, external, rss };
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { count: sorted.length, p50: sorted[Math.ceil(sorted.length * 0.50) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}

function run(api, documentApi) {
  const typing = scenario === "typing";
  const textScenario = typing || scenario === "paste";
  const rows = 2730;
  const rowWidth = 96;
  let editorText = Text.of(Array(rows).fill("x".repeat(rowWidth - 1)));
  const initial = documentApi.createDocumentState({
    manifest: { format: "mdpkg", version: "2.0", entrypoint: "index.md" },
    entrypoint: "index.md",
    files: [{ path: "index.md", is_text: true, content: textScenario ? editorText.toString() : "# Attachments", base64: null }],
  }, "benchmark.mdpkg");
  let current = initial;
  const history = api.createEditHistory();
  const iterations = Number(process.env.MACA_BENCH_ITERATIONS ?? (typing ? 10000 : textScenario ? 4000 : 6));
  assert(Number.isSafeInteger(iterations) && iterations > 0, "MACA_BENCH_ITERATIONS must be a positive integer");
  const bytesPerAttachment = 48 * 2 ** 20;
  const record = [];
  const add = [];
  const remove = [];
  const undo = [];
  const redo = [];
  const baseline = memory();
  let peakRss = baseline.rss;
  const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  function recordOperation(next, entry, elapsed) {
    api.recordEdit(history, entry);
    api.sameSavedContent(next, initial);
    current = next;
    return performance.now() - elapsed;
  }
  function addAttachment(index) {
    const base64 = Buffer.alloc(bytesPerAttachment, scenario === "repeat" ? 0xa5 : 0xa5 ^ index).toString("base64");
    const started = performance.now();
    // The fallback lets the same benchmark run against revisions before payload sharing.
    const payload = api.reuseAttachmentPayload?.(history, base64) ?? base64;
    const added = documentApi.addAttachment(current, "large.zip", payload, "index.md");
    const next = documentApi.updateFileContent(added.state, "index.md", current.files[0].content + "\n[Attachment](attachments/large.zip)");
    add.push(recordOperation(next, api.fileHistoryEntry(current, next, "Add attachment"), started));
    return added.path;
  }
  for (let index = 0; index < iterations; index++) {
    if (textScenario) {
      const started = performance.now();
      const position = (index * 683 % rows) * rowWidth + 32;
      const width = typing ? 1 : 48;
      const value = editorText.sliceString(position, position + 1) === "a" ? "b" : "a";
      editorText = editorText.replace(position, position + width, Text.of([value.repeat(width)]));
      const next = documentApi.updateFileContent(current, "index.md", editorText.toString());
      record.push(recordOperation(next, api.textHistoryEntry("index.md", current.files[0].content, next.files[0].content,
        current.staleResources, next.staleResources), started));
    } else {
      const path = addAttachment(index);
      sample();
      const deleting = performance.now();
      const deleted = documentApi.deletePath(current, path);
      remove.push(recordOperation(deleted, api.fileHistoryEntry(current, deleted, "Delete attachment"), deleting));
    }
    if (index % 64 === 0) sample();
  }
  const edited = memory();
  const finalFileContents = current.files.map((file) => file.content);
  const entryCount = history.entries.length;

  const replay = (direction, values) => {
    for (let index = 0; index < entryCount; index++) {
      const started = performance.now();
      const entry = history.entries[direction === "undo" ? history.cursor - 1 : history.cursor];
      current = api.applyEditHistoryEntry(current, entry, direction);
      history.cursor += direction === "undo" ? -1 : 1;
      api.sameSavedContent(current, initial);
      values.push(performance.now() - started);
      if (index % 64 === 0) sample();
    }
  };
  replay("undo", undo);
  assert(api.sameSavedContent(current, initial));
  const undone = memory();
  replay("redo", redo);
  assert.deepEqual(current.files.map((file) => file.content), finalFileContents);
  // Attachment histories are short. Sample repeated sweeps to make their p95 useful.
  for (let sweep = 1; !textScenario && sweep < 30; sweep++) {
    replay("undo", undo);
    replay("redo", redo);
  }
  const redone = memory();
  let branched;
  if (!textScenario) {
    replay("undo", []);
    const before = current.files[0].content;
    const next = documentApi.updateFileContent(current, "index.md", before + "!");
    recordOperation(next, api.textHistoryEntry("index.md", before, next.files[0].content,
      current.staleResources, next.staleResources), performance.now());
    assert.equal(history.entries.length, 1);
    branched = memory();
  }
  return { scenario, node: process.version, cpu: cpus()[0].model, iterations, entryCount,
    inputBytes: textScenario ? Buffer.byteLength(initial.files[0].content) : bytesPerAttachment,
    memoryBytes: { baseline, edited, undone, redone, branched, peakRss },
    milliseconds: { ...(textScenario ? { record: stats(record) } : { add: stats(add), remove: stats(remove) }),
      undo: stats(undo), redo: stats(redo) } };
}
