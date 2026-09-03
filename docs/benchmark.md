# RepoScope Benchmark Protocol

RepoScope should be judged on two axes at the same time:

1. **Task effectiveness** — did the coding task actually pass verification?
2. **Context efficiency** — how much repository/model context was consumed to get there?

A reduction number without task success is not a useful product result.

## Experimental design

For each task, run the same coding Agent twice against the same repository revision:

- `baseline`: the Agent works normally without RepoScope controlling repository context.
- `reposcope`: the Agent uses RepoScope as its repository context gateway.

Keep these fixed within a pair:

- repository
- commit
- task description / acceptance criteria
- Agent and model configuration
- verification command
- trial identifier

Change only whether RepoScope is used for repository exploration.

## JSONL format

Store one JSON object per run. A minimal pair looks like:

```json
{"schemaVersion":1,"runId":"checkout-baseline-1","taskId":"checkout-bug","mode":"baseline","agent":"codex","repository":"company/app","commit":"abc123","trial":"1","outcome":"success","verification":"passed","metrics":{"durationMs":120000,"filesRead":34,"sourceTokens":48000,"modelInputTokens":76000,"modelOutputTokens":5200,"toolCalls":18}}
{"schemaVersion":1,"runId":"checkout-reposcope-1","taskId":"checkout-bug","mode":"reposcope","agent":"codex","repository":"company/app","commit":"abc123","trial":"1","outcome":"success","verification":"passed","metrics":{"durationMs":95000,"filesRead":8,"sourceTokens":7200,"mcpTokens":9100,"modelInputTokens":31000,"modelOutputTokens":4800,"toolCalls":12}}
```

The numbers above only demonstrate the schema; they are not benchmark results.

## Fields

Required run fields:

- `schemaVersion`: currently `1`.
- `runId`: globally unique record id within the file.
- `taskId`: stable task identifier shared by both arms.
- `mode`: `baseline` or `reposcope`.
- `agent`: stable Agent/model configuration label.
- `repository`: stable repository label.
- `outcome`: Agent-reported `success`, `failed`, or `abandoned`.
- `verification`: objective `passed`, `failed`, or `not_run`.
- `metrics`: measured values available for this run.

Recommended pairing fields:

- `commit`: exact repository revision. Baseline and RepoScope runs should use the same revision.
- `trial`: repeat identifier when running the same task more than once.

Optional metrics:

- `durationMs`: wall-clock task duration.
- `filesRead`: unique repository files delivered/read by the Agent.
- `sourceTokens`: repository source tokens delivered to the Agent.
- `modelInputTokens`: provider-observed model input tokens, when available.
- `modelOutputTokens`: provider-observed model output tokens, when available.
- `toolCalls`: total relevant tool calls, when available.
- `mcpTokens`: RepoScope MCP payload tokens. Normally meaningful only for the RepoScope arm.

Do not invent missing measurements. Leave a metric absent if it cannot be observed reliably.

## Pairing rules

The report pairs runs only when all of these match:

```text
repository
commit
taskId
agent
trial
```

There must be exactly one `baseline` and one `reposcope` run for the key.

- Missing one arm -> `incompleteKeys`.
- Multiple runs for the same arm/key -> `ambiguousKeys`.
- Incomplete or ambiguous keys are never used for reduction calculations.

## Success semantics

`outcome` and `verification` remain separate.

The primary effectiveness metric is **verified success rate**:

```text
verification == passed
```

An Agent saying `outcome: success` while `verification: failed` or `not_run` is not counted as verified success.

## Reduction semantics

For paired numeric metrics where both arms contain a value and the baseline is greater than zero:

```text
reductionPercent = (baseline - reposcope) / baseline * 100
```

Positive means RepoScope used less of that metric. Negative means RepoScope used more.

The report exposes both average and median paired reduction. Median should normally be preferred once the sample size grows because coding tasks can contain large outliers.

## Report command

```bash
npm run benchmark:report -- ./benchmark-results.jsonl
```

The report returns:

- total runs and unique tasks
- baseline vs RepoScope reported/verified success rates
- average/median observed metrics by arm
- complete/incomplete/ambiguous pair counts
- paired verification outcomes
- average/median reductions for every comparable metric

## What would validate the product?

The target is not simply the largest token reduction.

A useful RepoScope result looks like:

```text
verified success rate ~= baseline
source/model context materially lower
```

If context falls sharply but verified task success also falls, RepoScope has not proven its product hypothesis.
