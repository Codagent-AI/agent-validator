# Handoff: `call_agent` vs Cursor MCP timeout

This brief is for an Agent Runner agent. It is not the reviewer-override companion contract.

## Objective

Make `call_agent` usable from Cursor (and other MCP hosts with a short `tools/call` wait) when the child needs more than about a minute.

## Current State

`call_agent` is a single blocking MCP `tools/call`. The host waits until the child finishes, then returns the result.

Cursor’s MCP client times that wait at the TypeScript SDK default of **~60 seconds**. There is no timeout argument on the tool, no `mcp.json` timeout field, and no Cursor setting to raise it. Progress notifications do not extend the wait because Cursor does not pass `resetTimeoutOnProgress`. The failure is:

```text
MCP error -32001: Request timed out
```

This is a host-client limit, not a Runner-imposed call deadline. Runner’s own spec is not to put a duration limit on a valid agent call. Cursor still aborts the wait.

That showed up in this session: two sequential `call_agent` invocations with `agent: crosscheck` for a proposal review both died with `-32001` before any child output came back. A real crosscheck of that document needs several minutes of reading. It cannot complete on this path today. The same failure will hit any long child launched from Cursor Agent / ACP, not only this one review.

The Validator reviewer-override proposal is written. The required `crosscheck` via `call_agent` did not complete because of this timeout.

## Key Decisions

- **Option 1: job id, then poll** — Do not keep the MCP `tools/call` open until the child is done. Return a job identity quickly, then let the caller poll for status/result on later calls. Short calls can fit in Cursor’s 60-second wait; the child can keep running between polls.
- **Not a Cursor config fix** — Do not try to raise a host timeout or rely on MCP progress notifications. Those knobs do not exist or do not work in Cursor today.
- **No solution details here** — Job identity, polling, cancellation, and result delivery are for the Runner agent to figure out.

## Open Questions

- How job identity, polling, cancellation, and result delivery should work in Agent Runner.

## Next Steps

In the Agent Runner repository, propose and implement the job-id-then-poll shape for `call_agent` so a Cursor MCP client can drive a long child without holding one `tools/call` open for the whole run.

## Relevant Files

- `/Users/paul/codagent/agent-validator/openspec/changes/reviewer-override/proposal.md` — how this gap was found; unrelated slice
- `/Users/paul/codagent/agent-validator/openspec/changes/reviewer-override/handoff.md` — this brief
