import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api";
import {
  formatKnowledgeFactValue,
  formatKnowledgeKind,
  projectMapConnections,
  projectMapCoveragePercent,
  type ProjectMapConnection,
} from "@/lib/projectMap";
import { relativeTime } from "@/lib/relativeTime";
import { useUiStore } from "@/stores/useUiStore";
import type {
  KnowledgeEntity,
  KnowledgeFact,
  ProjectMapData,
  ProjectMapSearchHit,
} from "@/types/projectMap";
import { CloseIcon, MapIcon, RefreshIcon } from "@/components/shell/icons";

export default function ProjectMapDrawer({ project }: { project: string }) {
  const open = useUiStore((state) => state.projectMapOpen);
  const setOpen = useUiStore((state) => state.setProjectMapOpen);
  const [data, setData] = useState<ProjectMapData | null>(null);
  const [hits, setHits] = useState<ProjectMapSearchHit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryRequest = useRef(0);
  const hasData = data !== null;

  function adoptData(next: ProjectMapData | null) {
    setData(next);
    setSelectedId((current) => {
      if (current && next?.entities.some((entity) => entity.id === current)) {
        return current;
      }
      return (
        next?.entities.find((entity) => entity.kind === "project")?.id ??
        next?.entities[0]?.id ??
        null
      );
    });
  }

  function adopt(next: ProjectMapData | null) {
    adoptData(next);
    setHits(
      (next?.entities ?? []).slice(0, 50).map((entity) => ({
        entity,
        score: 0,
      })),
    );
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setQuery("");
    void api
      .readProjectMap(project)
      .then((next) => {
        if (alive) adopt(next);
      })
      .catch((nextError) => {
        if (alive) {
          adopt(null);
          setError(String(nextError));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      alive = false;
    };
  }, [open, project]);

  useEffect(() => {
    if (!open || !data) return;
    if (!query.trim()) {
      queryRequest.current += 1;
      setHits(
        data.entities.slice(0, 50).map((entity) => ({ entity, score: 0 })),
      );
      setQueryError(null);
      setQuerying(false);
      return;
    }
    const request = ++queryRequest.current;
    const timer = window.setTimeout(() => {
      setQuerying(true);
      setQueryError(null);
      void api
        .queryProjectMap(project, query, 50)
        .then((next) => {
          if (next.refreshedMap) adoptData(next.refreshedMap);
          if (request === queryRequest.current) setHits(next.hits);
        })
        .catch((nextError) => {
          if (request === queryRequest.current) {
            setHits([]);
            setQueryError(String(nextError));
          }
        })
        .finally(() => {
          if (request === queryRequest.current) setQuerying(false);
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [hasData, open, project, query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const next = await api.refreshProjectMap(project);
      adopt(next);
      setQuery("");
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setRefreshing(false);
    }
  }

  const selected = useMemo(
    () => data?.entities.find((entity) => entity.id === selectedId) ?? null,
    [data, selectedId],
  );
  const connections = useMemo(
    () =>
      data && selected
        ? projectMapConnections(data, selected.id)
        : { inbound: [], outbound: [] },
    [data, selected],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="project-map-backdrop fixed inset-0 z-[70] flex justify-end p-3"
      onMouseDown={() => setOpen(false)}
    >
      <section
        id="project-map-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-map-title"
        className="project-map-surface flex h-full w-[min(1080px,calc(100vw-1.5rem))] min-w-0 flex-col overflow-hidden rounded-2xl border"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-white/[0.08] px-5 py-4">
          <span className="project-map-mark mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-accent">
            <MapIcon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id="project-map-title" className="text-base font-semibold text-fg">
                Project Map
              </h2>
              {data && <MapHealth data={data} />}
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-dim">
              Searchable architecture and provenance for {projectName(project)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1.5 text-xs text-fg-muted hover:border-white/20 hover:bg-white/[0.07] hover:text-fg disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshIcon className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close project map"
            className="rounded-lg p-2 text-fg-dim hover:bg-white/5 hover:text-fg"
          >
            <CloseIcon />
          </button>
        </header>

        {loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState
            error={error}
            refreshing={refreshing}
            onRetry={() => void refresh()}
          />
        ) : !data ? (
          <EmptyState onBuild={() => void refresh()} refreshing={refreshing} />
        ) : (
          <>
            <MapSummary data={data} />
            {error && (
              <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-xs text-fg-muted">
                <span className="selectable min-w-0 break-words">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="shrink-0 text-fg-dim hover:text-fg"
                >
                  Dismiss
                </button>
              </div>
            )}
            <div className="project-map-grid min-h-0 flex-1">
              <EntityIndex
                hits={hits}
                query={query}
                querying={querying}
                queryError={queryError}
                selectedId={selectedId}
                searchRef={searchRef}
                onQuery={setQuery}
                onSelect={setSelectedId}
              />
              <EntityFacts entity={selected} />
              <EntityConnections
                entity={selected}
                inbound={connections.inbound}
                outbound={connections.outbound}
                onSelect={setSelectedId}
              />
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}

function MapHealth({ data }: { data: ProjectMapData }) {
  const { manifest } = data;
  const coverage = manifest.coverage;
  const coverageComplete =
    coverage.complete && !coverage.truncated && coverage.errors.length === 0;
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px] font-medium uppercase tracking-[0.09em]">
      <span
        className={`rounded-full border px-2 py-0.5 ${
          manifest.dirty.value
            ? "border-warning/30 bg-warning/[0.08] text-warning"
            : "border-success/25 bg-success/[0.07] text-success"
        }`}
        title={
          manifest.dirty.value
            ? manifest.dirty.reasons.map((reason) => reason.change).join("\n")
            : "No project changes have been recorded since this scan"
        }
      >
        {manifest.dirty.value ? "Changes pending" : "Recorded clean"}
      </span>
      <span className="rounded-full border border-white/10 px-2 py-0.5 text-fg-dim">
        scanned {relativeTime(manifest.generatedAt)}
      </span>
      <span
        className={`rounded-full border px-2 py-0.5 ${
          coverageComplete
            ? "border-white/10 text-fg-dim"
            : "border-warning/25 text-warning"
        }`}
      >
        {coverageComplete
          ? "complete coverage"
          : `${projectMapCoveragePercent(data)}% coverage`}
      </span>
    </div>
  );
}

function MapSummary({ data }: { data: ProjectMapData }) {
  const counts = data.manifest.coverage.counts;
  const coverage = data.manifest.coverage;
  const latestDirtyReason = data.manifest.dirty.reasons.at(-1);
  const partial =
    !coverage.complete || coverage.truncated || coverage.errors.length > 0;
  return (
    <div className="shrink-0 border-b border-white/[0.07] px-4 py-3">
      <div className="grid grid-cols-5 gap-2">
        <Stat label="Entities" value={data.entities.length} />
        <Stat label="Relations" value={data.relations.length} />
        <Stat
          label="Scripts"
          value={counts.firstPartyScripts + counts.packageScripts}
          detail={`${counts.firstPartyScripts} first-party`}
        />
        <Stat label="Scenes" value={counts.scenes} detail={`${counts.prefabs} prefabs`} />
        <Stat
          label="Files scanned"
          value={coverage.scanned}
          detail={`of ${coverage.discovered}`}
          warning={partial}
        />
      </div>
      {data.manifest.dirty.value && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-warning">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <span className="selectable truncate">
            Project changes were recorded after this scan
            {latestDirtyReason ? `: ${latestDirtyReason.change}` : "."}
          </span>
        </div>
      )}
      {partial && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-warning">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <span>
            This map is partial
            {coverage.truncated ? ` — scan cap ${coverage.cap} reached` : ""}
            {coverage.errors.length > 0
              ? ` — ${coverage.errors.length} scan ${coverage.errors.length === 1 ? "error" : "errors"}`
              : ""}
            .
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  warning,
}: {
  label: string;
  value: number;
  detail?: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${warning ? "text-warning" : "text-fg"}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-fg-dim">
        {label}
      </div>
      {detail && <div className="mt-0.5 text-[10px] text-fg-dim">{detail}</div>}
    </div>
  );
}

function EntityIndex({
  hits,
  query,
  querying,
  queryError,
  selectedId,
  searchRef,
  onQuery,
  onSelect,
}: {
  hits: ProjectMapSearchHit[];
  query: string;
  querying: boolean;
  queryError: string | null;
  selectedId: string | null;
  searchRef: React.RefObject<HTMLInputElement>;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="project-map-column min-h-0 border-r border-white/[0.07]">
      <div className="shrink-0 border-b border-white/[0.06] p-3">
        <label htmlFor="project-map-search" className="sr-only">
          Search project entities
        </label>
        <div className="relative">
          <input
            ref={searchRef}
            id="project-map-search"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Find scripts, systems, facts…"
            className="w-full rounded-lg border border-white/10 bg-black/25 py-2 pl-3 pr-8 text-xs text-fg outline-none placeholder:text-fg-dim/70 focus:border-accent/40"
          />
          {querying && (
            <span className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border border-fg-dim/30 border-t-fg-muted" />
          )}
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.1em] text-fg-dim">
          {hits.length} {hits.length === 1 ? "match" : "matches"}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {queryError ? (
          <p className="selectable p-3 text-xs leading-relaxed text-danger">
            {queryError}
          </p>
        ) : hits.length === 0 ? (
          <div className="p-5 text-center text-xs leading-relaxed text-fg-dim">
            No entities match this query.
          </div>
        ) : (
          <div className="space-y-1">
            {hits.map(({ entity }) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => onSelect(entity.id)}
                aria-pressed={selectedId === entity.id}
                className={`project-map-entity-row w-full rounded-lg border px-3 py-2.5 text-left ${
                  selectedId === entity.id
                    ? "border-accent/25 bg-accent/[0.08]"
                    : "border-transparent hover:border-white/[0.07] hover:bg-white/[0.035]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <KindGlyph kind={entity.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-fg">
                      {entity.name}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-fg-dim">
                      <span className="uppercase tracking-[0.08em]">
                        {formatKnowledgeKind(entity.kind)}
                      </span>
                      {entity.path && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{entity.path}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function EntityFacts({ entity }: { entity: KnowledgeEntity | null }) {
  return (
    <main className="project-map-column min-h-0 border-r border-white/[0.07]">
      {!entity ? (
        <ColumnEmpty>Select an entity to inspect its facts.</ColumnEmpty>
      ) : (
        <>
          <div className="shrink-0 border-b border-white/[0.06] px-4 py-3.5">
            <div className="flex items-center gap-2">
              <KindGlyph kind={entity.kind} large />
              <div className="min-w-0">
                <h3 className="selectable truncate text-sm font-semibold text-fg">
                  {entity.name}
                </h3>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                  {formatKnowledgeKind(entity.kind)} · {entity.scope}
                </div>
              </div>
            </div>
            {entity.path && (
              <div className="selectable mt-2 break-all font-mono text-[10px] leading-relaxed text-fg-dim">
                {entity.path}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SectionLabel>Facts · {entity.facts.length}</SectionLabel>
            {entity.facts.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-white/10 p-4 text-xs leading-relaxed text-fg-dim">
                No structured facts were recorded for this entity. Its path and
                relationships are still part of the map.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {entity.facts.map((fact, index) => (
                  <FactCard key={`${fact.key}:${index}`} fact={fact} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function FactCard({ fact }: { fact: KnowledgeFact }) {
  const source = `${fact.provenance.path}${
    fact.provenance.line ? `:${fact.provenance.line}` : ""
  }`;
  return (
    <article className="rounded-lg border border-white/[0.07] bg-white/[0.018] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.09em] text-fg-dim">
          {humanize(fact.key)}
        </div>
        {fact.provenance.heuristic && (
          <span className="rounded-full border border-warning/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-warning">
            heuristic
            {fact.confidence !== undefined
              ? ` · ${Math.round(fact.confidence * 100)}%`
              : ""}
          </span>
        )}
      </div>
      <div className="selectable mt-1 break-words text-xs leading-relaxed text-fg">
        {formatKnowledgeFactValue(fact.value)}
      </div>
      {fact.provenance.evidence && (
        <div className="selectable mt-2 break-words border-l border-white/10 pl-2 font-mono text-[10px] leading-relaxed text-fg-dim">
          {fact.provenance.evidence}
        </div>
      )}
      <div className="selectable mt-2 truncate font-mono text-[9px] text-fg-dim/80" title={source}>
        {fact.provenance.source} · {source}
      </div>
    </article>
  );
}

function EntityConnections({
  entity,
  inbound,
  outbound,
  onSelect,
}: {
  entity: KnowledgeEntity | null;
  inbound: ProjectMapConnection[];
  outbound: ProjectMapConnection[];
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="project-map-column min-h-0">
      {!entity ? (
        <ColumnEmpty>Relationships appear here.</ColumnEmpty>
      ) : (
        <div className="h-full overflow-y-auto p-3">
          <SectionLabel>Connections · {inbound.length + outbound.length}</SectionLabel>
          <div className="project-map-node mt-3 rounded-xl border border-accent/20 bg-accent/[0.07] px-3 py-2 text-center">
            <div className="truncate text-xs font-medium text-fg">{entity.name}</div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-fg-dim">
              selected
            </div>
          </div>
          <ConnectionGroup
            title="Feeds into this"
            direction="inbound"
            connections={inbound}
            onSelect={onSelect}
          />
          <ConnectionGroup
            title="Leads out to"
            direction="outbound"
            connections={outbound}
            onSelect={onSelect}
          />
          {inbound.length === 0 && outbound.length === 0 && (
            <p className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-xs leading-relaxed text-fg-dim">
              No inbound or outbound relationships were recorded for this
              entity.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

function ConnectionGroup({
  title,
  direction,
  connections,
  onSelect,
}: {
  title: string;
  direction: "inbound" | "outbound";
  connections: ProjectMapConnection[];
  onSelect: (id: string) => void;
}) {
  if (connections.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-fg-dim">
        <span>{direction === "inbound" ? "↓" : "↑"}</span>
        {title}
      </div>
      <div className="mt-1.5 space-y-1.5">
        {connections.slice(0, 60).map(({ relation, neighbor }) => (
          <button
            key={relation.id}
            type="button"
            disabled={!neighbor}
            onClick={() => neighbor && onSelect(neighbor.id)}
            title={`${relation.provenance.path}${
              relation.provenance.line ? `:${relation.provenance.line}` : ""
            }`}
            className="w-full rounded-lg border border-white/[0.07] bg-black/10 px-2.5 py-2 text-left hover:border-white/15 hover:bg-white/[0.035] disabled:cursor-default"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-accent">
                {direction === "inbound" ? "→" : "↗"}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                {neighbor?.name ??
                  (direction === "inbound" ? relation.from : relation.to)}
              </span>
            </div>
            <div className="mt-1 pl-[18px] text-[9px] uppercase tracking-[0.1em] text-fg-dim">
              {relation.kind}
              {relation.confidence !== undefined
                ? ` · ${Math.round(relation.confidence * 100)}%`
                : ""}
            </div>
          </button>
        ))}
      </div>
      {connections.length > 60 && (
        <div className="mt-2 text-[10px] text-fg-dim">
          {connections.length - 60} more connections omitted from this view
        </div>
      )}
    </div>
  );
}

function KindGlyph({
  kind,
  large = false,
}: {
  kind: KnowledgeEntity["kind"];
  large?: boolean;
}) {
  const glyph: Record<KnowledgeEntity["kind"], string> = {
    project: "◆",
    package: "▣",
    scene: "◫",
    prefab: "◇",
    script: "⌘",
    type: "T",
    module: "▦",
  };
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 font-mono text-accent ${
        large ? "h-8 w-8 text-xs" : "mt-0.5 h-5 w-5 text-[9px]"
      }`}
    >
      {glyph[kind]}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">
      {children}
    </div>
  );
}

function ColumnEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs leading-relaxed text-fg-dim">
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="text-center">
        <span className="mx-auto block h-5 w-5 animate-spin rounded-full border border-fg-dim/30 border-t-accent" />
        <p className="mt-3 text-xs text-fg-dim">
          Checking project-map freshness…
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  error,
  refreshing,
  onRetry,
}: {
  error: string;
  refreshing: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-danger/25 bg-danger/[0.07] text-danger">
          !
        </div>
        <h3 className="mt-4 text-sm font-medium text-fg">Couldn&apos;t read the project map</h3>
        <p className="selectable mt-2 break-words text-xs leading-relaxed text-fg-dim">
          {error}
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={refreshing}
          className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-fg-muted hover:bg-white/[0.08] hover:text-fg"
        >
          {refreshing ? "Rebuilding…" : "Rebuild map"}
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  onBuild,
  refreshing,
}: {
  onBuild: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <span className="project-map-mark mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 text-accent">
          <MapIcon className="h-5 w-5" />
        </span>
        <h3 className="mt-4 text-sm font-medium text-fg">No project map yet</h3>
        <p className="mt-2 text-xs leading-relaxed text-fg-dim">
          Build a searchable map of the project&apos;s scripts, types, scenes,
          packages, facts, and relationships.
        </p>
        <button
          type="button"
          onClick={onBuild}
          disabled={refreshing}
          className="mt-4 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {refreshing ? "Building…" : "Build project map"}
        </button>
      </div>
    </div>
  );
}

function humanize(value: string): string {
  return value.replace(/[._-]+/g, " ");
}

function projectName(project: string): string {
  return project.split(/[\\/]/).filter(Boolean).pop() ?? project;
}
