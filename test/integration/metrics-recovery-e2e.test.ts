import { afterEach, expect, test } from 'bun:test';
import { access, chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initGitRepo } from './helpers.js';
import { verifyDigest } from '../../src/metrics/jcs.js';
import type { ExportRecord, ModelAttempt } from '../../src/metrics/types.js';

// A controlled client owns its imported current heads, separately from delivery history.
function incorporate(records: ExportRecord[], heads: Record<string, ExportRecord> = {}) {
  for (const record of records) {
    expect(verifyDigest(record).valid).toBe(true);
    expect(record.original_consumer_context).toEqual({consumer:'fixture-client',context_id:'original-launch'});
    const key = `${record.record_type}:${record.record_id}`;
    const prior = heads[key];
    if (!prior || record.revision > prior.revision) heads[key] = record;
    else if (record.revision === prior.revision) expect(record.digest).toEqual(prior.digest);
  }
  return heads;
}

const roots: string[] = [];
const cli = path.resolve(import.meta.dir, '../../dist/index.js');
const nativeUsage = path.resolve(import.meta.dir, '../cli-adapters/fixtures/native-telemetry/codex-0.153.4.jsonl');
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true,force:true})));
});

async function setup(retention: number, failSecond: boolean) {
  await access(cli); // Missing build is a failure, never a skipped obligation.
  const node = Bun.which('node');
  expect(node).toBeTruthy();
  const root = await mkdtemp(path.join(os.tmpdir(), 'validator-metrics-journey-'));
  roots.push(root);
  const project = path.join(root, 'project');
  const bin = path.join(root, 'bin');
  await mkdir(path.join(project, '.validator'), {recursive:true});
  await mkdir(bin);
  await writeFile(path.join(project, '.validator/config.yml'), `base_branch: main
log_dir: logs
max_previous_logs: ${retention}
allow_parallel: false
cli:
  default_preference: [codex]
  adapters:
    codex:
      allow_tool_use: false
entry_points:
  - path: .
    reviews:
      - all-reviewers:
          builtin: all-reviewers
          num_reviews: 2
          parallel: false
`);
  await writeFile(path.join(project, '.gitignore'), 'logs/\n');
  await writeFile(path.join(project, 'example.ts'), 'export const value = 1;\n');
  await initGitRepo(project);
  await writeFile(path.join(project, 'example.ts'), 'export const value = 2;\n');
  const countFile = path.join(root, 'dispatch-count');
  const stub = `#!${node}
const fs = require('node:fs');
if (!process.argv.includes('exec')) { console.log('codex-cli fixture'); process.exit(0); }
fs.readFileSync(0, 'utf8');
const file = ${JSON.stringify(countFile)};
const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) + 1 : 1;
fs.writeFileSync(file, String(count));
process.stdout.write(fs.readFileSync(${JSON.stringify(nativeUsage)}, 'utf8'));
if (${failSecond} && count === 2) { process.stderr.write('controlled fixture failure'); process.exitCode = 17; }
else process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({status:'pass',message:'fixture pass'})}})+'\\n');
`;
  await writeFile(path.join(bin, 'codex'), stub);
  await chmod(path.join(bin, 'codex'), 0o755);
  // Every provider fallback/health probe is local and refuses model work.
  for (const name of ['claude','copilot','gemini','opencode','agent']) {
    await writeFile(path.join(bin,name), '#!/bin/sh\nexit 1\n');
    await chmod(path.join(bin,name),0o755);
  }
  const env = {...process.env, PATH:`${bin}:${process.env.PATH}`, CI:undefined, GITHUB_ACTIONS:undefined, GITHUB_BASE_REF:undefined, GITHUB_SHA:undefined};
  const run = async (args: string[], extraEnv: Record<string,string> = {}) => {
    const child = Bun.spawn([node!,cli,...args], {cwd:project,env:{...env,...extraEnv},stdout:'pipe',stderr:'pipe'});
    const [code, stdout, stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,stdout,stderr};
  };
  const validationArgs = ['run','--metrics-consumer','fixture-client','--metrics-context','original-launch'];
  const metricArgs = (operation: string) => ['metrics',operation,'--consumer','fixture-client','--context','original-launch','--protocol-version','1'];
  const exported = async () => {
    const result = await run([...metricArgs('export'),'--measurement-version','1']);
    expect(result.code, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  return {root,project,node:node!,env,run,validationArgs,metricArgs,exported};
}

test('E2E-001: failed measured review retries under a new invocation and survives success cleanup', async () => {
  const fixture = await setup(2, true);
  const first = await fixture.run(fixture.validationArgs);
  expect(first.code,first.stderr).toBe(1);
  const before = JSON.parse(await readFile(path.join(fixture.project,'logs/validation-metrics.json'),'utf8'));
  expect(before.attempts, first.stdout + first.stderr).toHaveLength(2);
  expect(before.attempts.some((attempt: {outcome:string}) => attempt.outcome === 'error')).toBe(true);
  await writeFile(path.join(fixture.project, 'example.ts'), 'export const value = 3;\n');
  const retry = await fixture.run(fixture.validationArgs);
  expect(retry.code,retry.stderr).toBe(0);
  const after = JSON.parse(await readFile(path.join(fixture.project,'logs/validation-metrics.json'),'utf8'));
  expect(after.session.session_id).toBe(before.session.session_id);
  expect(after.current_invocation_id).not.toBe(before.current_invocation_id);
  expect(after.attempts.length).toBeGreaterThan(before.attempts.length);
  expect(new Set(after.attempts.map((attempt: {attempt_id:string}) => attempt.attempt_id)).size).toBe(after.attempts.length);
  for (const original of before.attempts) expect(after.attempts.find((attempt: {attempt_id:string}) => attempt.attempt_id === original.attempt_id)).toEqual(original);
  const currentCount = after.attempts.filter((attempt: {invocation_id:string}) => attempt.invocation_id === after.current_invocation_id).length;
  expect(after.aggregates.current_invocation.tokens.input_total.value).toBe(12766 * currentCount);
  expect(after.aggregates.session.tokens.input_total.value).toBe(12766 * after.attempts.length);
  expect(after.attempts[0].tokens.cache_write.value).toBeNull();
  const archived = JSON.parse(await readFile(path.join(fixture.project,'logs/previous/validation-metrics.json'),'utf8'));
  expect(archived.attempts).toEqual(after.attempts);
  const batch = await fixture.exported();
  expect(batch.records.some((record: {record_type:string}) => record.record_type === 'model_attempt')).toBe(true);
}, 30000);

test('E2E-002: metrics-only delivery survives interrupted closure and both consumer save/ack crash boundaries', async () => {
  const fixture = await setup(0, false);
  const ready = path.join(fixture.root,'closure-ready');
  const preload = path.join(fixture.root,'closure-barrier.cjs');
  await writeFile(preload, `const fs=require('node:fs');const original=fs.promises.rename;
fs.promises.rename=async function(from,to){const result=await original.call(this,from,to);
if(String(to).endsWith('/journal.json') && JSON.parse(fs.readFileSync(to,'utf8')).phase==='closing') {
fs.writeFileSync(${JSON.stringify(ready)},'ready');process.kill(process.pid,'SIGSTOP');}return result;};`);
  const child = Bun.spawn([fixture.node,cli,...fixture.validationArgs], {cwd:fixture.project,env:{...fixture.env,NODE_OPTIONS:`--require=${preload}`},stdout:'pipe',stderr:'pipe'});
  const output = Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
  try {
    const deadline = Date.now()+15000;
    while (true) {
      if (await access(ready).then(()=>true,()=>false)) break;
      if (Date.now()>deadline) throw new Error('closure barrier not reached');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  } finally {
    child.kill('SIGKILL');
    await child.exited;
    await output;
  }
  const first = await fixture.exported();
  const replay = await fixture.exported(); // Crash before client save: nothing consumed.
  expect(replay.records).toEqual(first.records);
  expect(replay.receipt).toBe(first.receipt);
  expect(first.records.filter((record: {record_type:string})=>record.record_type==='model_attempt').length).toBeGreaterThan(0);
  const saved = path.join(fixture.root,'client-saved.json');
  const handle = await open(saved, 'wx');
  const heads = incorporate(first.records);
  const attempts = Object.values(heads).filter(record=>record.record_type==='model_attempt');
  expect(attempts).toHaveLength(2);
  expect(attempts.reduce((sum,record)=>sum+(record.payload as ModelAttempt).tokens.input_total.value!,0)).toBe(12766*2);
  await handle.writeFile(JSON.stringify({...first, heads}));
  await handle.sync();
  await handle.close();
  const directory = await open(fixture.root, 'r');
  await directory.sync();
  await directory.close();
  // The client crash simulation retains its saved records and outstanding receipt.
  const retained = JSON.parse(await readFile(saved,'utf8'));
  expect((await fixture.exported()).records).toEqual(retained.records);
  expect(incorporate(retained.records, retained.heads)).toEqual(heads);
  const ackArgs = [...fixture.metricArgs('acknowledge'),'--receipt',retained.receipt];
  expect((await fixture.run(ackArgs)).code).toBe(0);
  expect((await fixture.run(ackArgs)).code).toBe(0);
  expect((await fixture.exported()).evidence_state).toBe('previously_acknowledged');
  // Existing run-lock policy requires manual removal after an ungraceful exit.
  // Delivery above deliberately succeeded while that lock was still present.
  const runLock = path.join(fixture.project,'logs/.validator-run.lock');
  expect(await readFile(runLock,'utf8')).toBe(String(child.pid));
  await rm(runLock); // This exact test-owned child has already been killed/reaped.
  const clean = await fixture.run(['clean']);
  expect(clean.code, clean.stdout+clean.stderr).toBe(0);
  expect((await fixture.exported()).evidence_state).toBe('previously_acknowledged');
  const snapshot = JSON.parse(await readFile(path.join(fixture.project,'logs/validation-metrics.json'),'utf8'));
  expect(snapshot.attempts).toHaveLength(2);
}, 30000);
