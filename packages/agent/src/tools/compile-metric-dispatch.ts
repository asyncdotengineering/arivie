/* SPDX-License-Identifier: Apache-2.0 */
import { getCurrentUserContext } from "@arivie/core/context";
import type {
  LifecycleHooks,
  LimitConfig,
  SourceAdapter,
  SourceAdapterCompileMetricOpts,
  SourceAdapterExecuteOpts,
} from "@arivie/core/types";
import { ToolError, validateExecuteSql } from "@arivie/db-postgres";
import type { Entity, Join, Measure, SemanticLayer } from "@arivie/semantic";
import { crossSourceHashJoin } from "../cross-source.js";

export interface CompileMetricArgs {
  metric: string;
  dimensions?: string[] | undefined;
  filters?: Record<string, unknown> | undefined;
  segments?: string[] | undefined;
  entityHint?: string | undefined;
}

interface MetricCandidate {
  entity: Entity;
  measure: Measure;
}

function findMetricCandidates(
  semantic: SemanticLayer,
  metricName: string,
): MetricCandidate[] {
  const candidates: MetricCandidate[] = [];
  for (const entity of semantic.entities.values()) {
    for (const measure of entity.measures ?? []) {
      if (measure.name === metricName) {
        candidates.push({ entity, measure });
      }
    }
  }
  return candidates;
}

export function resolveMetric(
  semantic: SemanticLayer,
  metricName: string,
  entityHint: string | undefined,
): MetricCandidate {
  const candidates = findMetricCandidates(semantic, metricName);

  if (candidates.length === 0) {
    throw new ToolError(
      "metric-not-found",
      `metric '${metricName}' not defined in semantic layer`,
    );
  }

  if (candidates.length > 1 && entityHint == null) {
    throw new ToolError(
      "metric-ambiguous",
      `metric '${metricName}' defined in multiple entities: ${candidates.map((c) => c.entity.name).join(", ")}; provide entityHint`,
    );
  }

  if (entityHint != null) {
    const match = candidates.find((c) => c.entity.name === entityHint);
    if (match == null) {
      throw new ToolError(
        "metric-not-found",
        `metric '${metricName}' not defined in semantic layer`,
      );
    }
    return match;
  }

  return candidates[0]!;
}

export function entityAdapter(entity: Entity): string {
  const source = entity.source as
    | { adapter: string; instance?: string }
    | undefined;
  if (source != null && typeof source === "object" && "adapter" in source) {
    return source.adapter;
  }
  return "postgres";
}

function findSourceAdapter(
  sources: Record<string, SourceAdapter<unknown>>,
  adapterName: string,
): SourceAdapter<unknown> {
  const adapter = sources[adapterName];
  if (adapter == null) {
    throw new ToolError(
      "source-not-found",
      `no source registered for adapter '${adapterName}'`,
    );
  }
  if (adapter.compileMetric == null) {
    throw new ToolError(
      "source-no-compile",
      `${adapterName} adapter does not implement compileMetric`,
    );
  }
  return adapter;
}

function compileOpts(
  entity: Entity,
  args: CompileMetricArgs,
  dimensions?: string[],
): SourceAdapterCompileMetricOpts {
  return {
    entity,
    metric: args.metric,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(args.filters !== undefined ? { filters: args.filters } : {}),
    ...(args.segments !== undefined ? { segments: args.segments } : {}),
  };
}

function serializeQuery(query: unknown): string {
  return typeof query === "string" ? query : JSON.stringify(query);
}

function partitionDimensions(
  entity: Entity,
  dimensionNames: string[],
): { primary: string[]; crossByEntity: Map<string, string[]> } {
  const primary: string[] = [];
  const crossByEntity = new Map<string, string[]>();

  for (const dim of dimensionNames) {
    const dot = dim.indexOf(".");
    if (dot > 0) {
      const prefix = dim.slice(0, dot);
      const local = dim.slice(dot + 1);
      if (prefix !== entity.name) {
        const bucket = crossByEntity.get(prefix) ?? [];
        bucket.push(local);
        crossByEntity.set(prefix, bucket);
        continue;
      }
    }
    primary.push(dim);
  }

  return { primary, crossByEntity };
}

function parseJoinOn(
  on: string,
  leftEntity: string,
  rightEntity: string,
): { left: string; right: string } {
  const match = on.trim().match(/^(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)$/);
  if (match == null) {
    throw new ToolError("join-invalid", `cannot parse join on: ${on}`);
  }
  const [, e1, c1, e2, c2] = match;
  if (e1 === leftEntity && e2 === rightEntity) {
    return { left: c1!, right: c2! };
  }
  if (e2 === leftEntity && e1 === rightEntity) {
    return { left: c2!, right: c1! };
  }
  throw new ToolError(
    "join-invalid",
    `join on '${on}' does not reference '${leftEntity}' and '${rightEntity}'`,
  );
}

interface CrossSourceJoin {
  join: Join;
  target: Entity;
}

function detectCrossSourceJoins(
  semantic: SemanticLayer,
  entity: Entity,
  dimensionNames: string[],
): CrossSourceJoin[] {
  const { crossByEntity } = partitionDimensions(entity, dimensionNames);
  const cross: CrossSourceJoin[] = [];
  const fromAdapter = entityAdapter(entity);

  for (const toName of crossByEntity.keys()) {
    const target = semantic.entities.get(toName);
    if (target == null) {
      continue;
    }
    if (entityAdapter(target) === fromAdapter) {
      continue;
    }
    const join = (entity.joins ?? []).find(
      (j) => j.to === toName && j.strategy === "client-side",
    );
    if (join == null) {
      throw new ToolError(
        "cross-source-not-wired",
        `cross-source dimension '${toName}' requires client-side join on entity '${entity.name}'`,
      );
    }
    cross.push({ join, target });
  }

  return cross;
}

function defaultSideMetric(entity: Entity, metricName: string): string {
  const named = entity.measures?.find((m) => m.name === metricName);
  if (named != null) {
    return named.name;
  }
  const first = entity.measures?.[0];
  if (first == null) {
    throw new ToolError(
      "metric-not-found",
      `entity '${entity.name}' has no measures for cross-source compile`,
    );
  }
  return first.name;
}

export interface DispatchCompileMetricOptions {
  readonly semantic: SemanticLayer;
  readonly sources: Record<string, SourceAdapter<unknown>>;
  readonly ownerId: string;
  readonly limits: LimitConfig;
  readonly hooks?: LifecycleHooks;
}

export async function dispatchCompileMetric(
  opts: DispatchCompileMetricOptions,
  args: CompileMetricArgs,
): Promise<{
  sql: string;
  params: unknown[];
  rows: Record<string, unknown>[];
  rowCount: number;
}> {
  const { entity } = resolveMetric(opts.semantic, args.metric, args.entityHint);
  const dimensionNames = args.dimensions ?? [];
  const crossJoins = detectCrossSourceJoins(
    opts.semantic,
    entity,
    dimensionNames,
  );

  const user = getCurrentUserContext();
  if (user == null) {
    throw new Error("no user context — auth resolver did not run");
  }

  const rowLimit = opts.limits.rowsPerQuery ?? 50;
  const timeoutMs = opts.limits.queryTimeoutMs ?? 30_000;

  if (crossJoins.length > 0) {
    const { primary, crossByEntity } = partitionDimensions(
      entity,
      dimensionNames,
    );
    const primaryAdapterName = entityAdapter(entity);
    const primaryAdapter = findSourceAdapter(opts.sources, primaryAdapterName);
    const primaryCompiled = primaryAdapter.compileMetric!(
      compileOpts(entity, args, primary),
    );
    if (primaryAdapter.kind === "postgres") {
      validateExecuteSql(serializeQuery(primaryCompiled.query));
    }

    await opts.hooks?.onBeforeQuery?.({
      sql: serializeQuery(primaryCompiled.query),
      userId: user.userId,
      ownerId: opts.ownerId,
    });

    const primaryCredentials = user.credentials?.[primaryAdapterName];
    const primaryExecuteOpts: SourceAdapterExecuteOpts<unknown> = {
      query: primaryCompiled.query,
      runAsRole: user.dbRole,
      userId: user.userId,
      rowLimit,
      timeoutMs,
      ...(primaryCredentials !== undefined ? { credentials: primaryCredentials } : {}),
    };
    primaryExecuteOpts.params = primaryCompiled.params ?? [];
    const primaryResult = await primaryAdapter.execute(primaryExecuteOpts);

    let leftRows = primaryResult.rows;
    let leftEntity = entity;
    const queries: unknown[] = [primaryCompiled.query];

    for (const { join, target } of crossJoins) {
      const sideAdapterName = entityAdapter(target);
      const sideAdapter = findSourceAdapter(opts.sources, sideAdapterName);
      const sideMetric = defaultSideMetric(target, args.metric);
      const sideDims = crossByEntity.get(target.name);
      const sideCompiled = sideAdapter.compileMetric!(
        compileOpts(
          target,
          { ...args, metric: sideMetric },
          sideDims,
        ),
      );
      queries.push(sideCompiled.query);

      const sideCredentials = user.credentials?.[sideAdapterName];
      const sideExecuteOpts: SourceAdapterExecuteOpts<unknown> = {
        query: sideCompiled.query,
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit,
        timeoutMs,
        ...(sideCredentials !== undefined ? { credentials: sideCredentials } : {}),
      };
      sideExecuteOpts.params = sideCompiled.params ?? [];
      const sideResult = await sideAdapter.execute(sideExecuteOpts);

      const joinOn = parseJoinOn(join.on, entity.name, target.name);
      const joined = crossSourceHashJoin({
        leftRows,
        rightRows: sideResult.rows,
        leftEntity,
        rightEntity: target,
        joinOn,
      });
      leftRows = joined.rows;
      leftEntity = entity;
    }

    await opts.hooks?.onAfterQuery?.({
      sql: JSON.stringify(queries),
      rows: leftRows,
      durationMs: 0,
      userId: user.userId,
      ownerId: opts.ownerId,
    });

    return {
      sql: JSON.stringify(queries),
      params: primaryCompiled.params ?? [],
      rows: leftRows,
      rowCount: leftRows.length,
    };
  }

  const adapterName = entityAdapter(entity);
  const adapter = findSourceAdapter(opts.sources, adapterName);
  const compiled = adapter.compileMetric!(compileOpts(entity, args));
  const sql = serializeQuery(compiled.query);
  const params = compiled.params ?? [];

  if (adapter.kind === "postgres") {
    validateExecuteSql(sql);
  }

  await opts.hooks?.onBeforeQuery?.({
    sql,
    userId: user.userId,
    ownerId: opts.ownerId,
  });

  const credentials = user.credentials?.[adapterName];
  const executeOpts: SourceAdapterExecuteOpts<unknown> = {
    query: compiled.query,
    runAsRole: user.dbRole,
    userId: user.userId,
    rowLimit,
    timeoutMs,
    ...(credentials !== undefined ? { credentials } : {}),
  };
  executeOpts.params = compiled.params ?? [];
  const result = await adapter.execute(executeOpts);

  await opts.hooks?.onAfterQuery?.({
    sql,
    rows: result.rows,
    durationMs: result.durationMs,
    userId: user.userId,
    ownerId: opts.ownerId,
  });

  return {
    sql,
    params,
    rows: result.rows,
    rowCount: result.rowCount,
  };
}
