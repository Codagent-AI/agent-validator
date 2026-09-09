import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MetricsStore, type MetricsExport } from '../../src/metrics/store.js';
import { validateExportRecord } from '../../src/metrics/validation.js';
import { selectLatestHeads } from '../../src/metrics/projections.js';
import type { ModelAttempt } from '../../src/metrics/types.js';
import { canonicalizeJson, createDigest } from '../../src/metrics/jcs.js';

const directory = path.resolve(import.meta.dir, '../../contracts/model-metrics/v1/fixtures');
const inventory = JSON.parse(await readFile(path.join(directory, 'delivery-scenarios.json'), 'utf8'));
const source = JSON.parse(await readFile(path.join(directory, inventory.record_source), 'utf8'));
test('shared protocol scenario bytes and hash are pinned', async () => {
  const manifest = JSON.parse(await readFile(path.join(directory, '../fixture-manifest.json'), 'utf8'));
  const entry = manifest.protocol_cases.find((entry: {name: string})=>entry.name==='delivery-scenarios');
  expect(entry).toBeDefined();
  expect(createDigest(inventory).value).toBe(entry.expected_digest);
  expect(canonicalizeJson(inventory)).toBe((await readFile(path.join(directory,'../',entry.canonical_utf8),'utf8')).trimEnd());
});
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true, force:true}))); });

for (const scenario of inventory.scenarios) {
  test(`shared delivery fixture: ${scenario.name}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'validator-delivery-fixture-'));
    roots.push(root);
    const store = await MetricsStore.open(root);
    const batches = new Map<string, MetricsExport>();
    const imported: ModelAttempt[] = [];
    const scope = {consumer:inventory.consumer_context.consumer, context:inventory.consumer_context.context_id, protocolVersion:1};
    for (const step of scenario.steps) {
      if (step.operation === 'commit') {
        const record = source.records.find((record: ModelAttempt) => record.revision === step.revision);
        expect(record).toBeDefined();
        await store.commit([{...record,consumer_context:inventory.consumer_context}]);
        continue;
      }
      if (step.operation === 'export') {
        const before = await readFile(path.join(root,'.metrics/state.json'),'utf8');
        const promise = store.exportPending({...scope, measurementVersions:step.measurement_versions ?? [1], maxRecords:step.max_records});
        if (step.error) {
          await expect(promise).rejects.toThrow(step.error);
          if (step.required_measurement_schema_versions) await expect(promise).rejects.toMatchObject({code:'unsupported_version',required_measurement_schema_versions:step.required_measurement_schema_versions});
          expect(await readFile(path.join(root,'.metrics/state.json'),'utf8')).toBe(before);
          continue;
        }
        const batch = await promise;
        expect(batch.records.map(record=>record.revision)).toEqual(step.revisions);
        if (step.evidence_state) expect(batch.evidence_state).toBe(step.evidence_state);
        if (step.remaining !== undefined) expect(batch.batch.remaining_revision_count).toBe(step.remaining);
        if (step.same_as) {
          expect(batch.records).toEqual(batches.get(step.same_as)!.records);
          expect(batch.receipt).toBe(batches.get(step.same_as)!.receipt);
        }
        if (step.label) batches.set(step.label, batch);
        for (const record of batch.records) {
          expect(validateExportRecord(record).success).toBe(true);
          expect(record.original_consumer_context).toEqual(inventory.consumer_context);
          imported.push(record.payload as ModelAttempt);
        }
        // A restarted client folds all saved/replayed records by producer identity.
        const heads = selectLatestHeads(imported);
        expect(heads.diagnostics).toEqual([]);
        expect(heads.records.length).toBe(imported.length ? 1 : 0);
        continue;
      }
      const receipt = batches.get(step.receipt)!.receipt!;
      const promise = step.operation === 'discard'
        ? store.discardReceipt({...scope,receipt})
        : store.acknowledgeReceipt({...scope,receipt});
      if (step.error_code) await expect(promise).rejects.toMatchObject({code: step.error_code});
      else if (step.error) await expect(promise).rejects.toThrow(step.error);
      else await promise;
    }
  });
}
