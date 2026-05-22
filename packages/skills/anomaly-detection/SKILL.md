---
name: anomaly-detection
description: Identify outliers in a time series of a metric — periods where the value is materially higher/lower than the recent trend. Computes z-scores or %-deviation from rolling baseline and surfaces the top N anomalies with hypotheses for what caused them.
when_to_use: |
  Load this skill when the user asks about:
    - "Is there an anomaly" / "outliers" / "unusual" / "weird"
    - "Why is X spiking" / "why did Y drop"
    - "Find anything unexpected"
    - "Did anything change this week"
  DON'T load for:
    - Single-period values → `compile_metric` direct
    - Forward-looking predictions → out of scope
inputs:
  - { name: metric, type: string, description: "Declared measure name OR custom expression to track over time" }
  - { name: grain, type: 'enum["hour","day","week","month"]', default: "day", description: "Time bucket" }
  - { name: lookback, type: integer, default: 90, description: "Number of {{grain}} periods to analyze" }
  - { name: threshold_zscore, type: number, default: 2.5, description: "Min |z-score| to flag as anomaly" }
  - { name: top_n, type: integer, default: 5, description: "Cap on anomalies surfaced" }
outputs:
  - { name: anomalies, type: "row[]", description: "{ period, value, baseline_mean, baseline_stddev, zscore, direction (up/down) }" }
  - { name: hypotheses, type: "string[]", description: "Per-anomaly LLM-generated guesses at causes (state these as guesses, not facts)" }
sources:
  - postgres
---

# Anomaly-detection playbook

## Phase 1 — Pull the time series

If `metric` is a declared measure with a time dimension declared:

```ts
compile_metric({
  metric: "{{metric}}",
  dimensions: ["created_at_{{grain}}"],
})
```

Otherwise fall back to `execute`:

```sql
SELECT
  date_trunc('{{grain}}', o.created_at)::date AS period,
  SUM(o.total_amount) FILTER (WHERE o.status = 'completed') AS value
FROM orders o
WHERE o.created_at >= NOW() - INTERVAL '{{lookback}} {{grain}}s'
GROUP BY 1
ORDER BY 1;
```

## Phase 2 — Compute the rolling baseline + z-scores

Use a window function. Rolling baseline = previous 14 periods (or `lookback / 6`, whichever is smaller).

```sql
WITH series AS ( /* … Phase 1 query … */ ),
windowed AS (
  SELECT
    period,
    value,
    AVG(value)    OVER (ORDER BY period ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING) AS baseline_mean,
    STDDEV(value) OVER (ORDER BY period ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING) AS baseline_stddev
  FROM series
)
SELECT
  period,
  value,
  baseline_mean,
  baseline_stddev,
  CASE
    WHEN baseline_stddev = 0 OR baseline_stddev IS NULL THEN NULL
    ELSE (value - baseline_mean) / baseline_stddev
  END AS zscore,
  CASE
    WHEN value > baseline_mean THEN 'up'
    WHEN value < baseline_mean THEN 'down'
    ELSE 'flat'
  END AS direction
FROM windowed
WHERE baseline_mean IS NOT NULL                        -- skip warmup periods
ORDER BY ABS(
  CASE WHEN baseline_stddev = 0 OR baseline_stddev IS NULL THEN 0
       ELSE (value - baseline_mean) / baseline_stddev END
) DESC NULLS LAST
LIMIT {{top_n}};
```

## Phase 3 — Filter to actual anomalies

In your answer (not another SQL roundtrip): keep only rows where `|zscore| >= {{threshold_zscore}}`. If fewer than 1 row meets the threshold, say so honestly — "no anomalies in the last {{lookback}} {{grain}}s above the {{threshold_zscore}} z-score threshold." Don't fabricate.

## Phase 4 — Hypothesise causes

For each surfaced anomaly, suggest a hypothesis. **Mark these as hypotheses, not facts.** Drill-in patterns:

| Anomaly direction | Hypothesis pattern |
|---|---|
| Spike up | "Possible promotion / marketing campaign / external referral. Check `signup_source` distribution for that period vs baseline." |
| Spike down | "Possible system outage / paid-channel pause / weekend/holiday effect. Check whether order count dropped proportionally." |
| Flat-then-cliff | "Possible measurement change (new column, new filter, tracking break). Check schema git history." |

OFFER to drill in (don't auto-execute). "The Mar 18 spike (+3.2σ) — want me to break down what segment drove it?"

## Phase 5 — Self-correction

- **Every period is a 'flat' direction with z=0**? Your `STDDEV` window may be 0 because all values are identical. Verify the underlying metric isn't returning a constant.
- **All anomalies are within the first 14 periods**? They're warmup artifacts — the rolling baseline isn't established yet. Increase `lookback` or `WHERE period > first_14_periods`.
- **The `baseline_stddev` is huge**? Your data is too noisy for z-scores — switch to %-deviation: `(value - baseline_mean) / baseline_mean` and threshold at 30%.

## Phase 6 — Multi-anomaly clustering

If 3+ consecutive periods exceed the threshold, **don't surface them as N separate anomalies** — surface as ONE "regime change":

> "Revenue underwent a regime change starting Mar 18 — z-scores stayed above 2.5 for 5 consecutive days. This isn't a spike; it's a shift."

This avoids spamming the user with "Mar 18 spike," "Mar 19 spike," "Mar 20 spike" when the real signal is "something changed Mar 18."

## JOIN discipline reminder

If your Phase 1 query joins customers or products, use LEFT JOIN if you want the metric to include orders without those associations. INNER drops the rest.

## Output format

- **Result:** one-paragraph summary of how many anomalies were found, top one's z-score and direction.
- **Assumptions:** baseline window size, z-threshold, metric definition, time grain.
- **SQL:** the window-function query.
- **Anomalies table** (period, value, baseline_mean, zscore, direction, hypothesis) after the three sections.
