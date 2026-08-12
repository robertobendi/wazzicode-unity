import type {
  KnowledgeEntity,
  KnowledgeEntityKind,
  KnowledgeFact,
  KnowledgeRelation,
  KnowledgeRelationKind,
  ProjectMapData,
  ProjectMapSearchHit,
} from "@/types/projectMap";

export type ProjectMapFacet = "all" | KnowledgeEntityKind;

export interface ProjectMapHitGroup {
  kind: KnowledgeEntityKind;
  label: string;
  hits: ProjectMapSearchHit[];
}

export interface ProjectMapFactGroup {
  key: string;
  facts: KnowledgeFact[];
}

export interface ProjectMapConnection {
  relation: KnowledgeRelation;
  neighbor: KnowledgeEntity | null;
}

export function projectMapCoveragePercent(data: ProjectMapData): number {
  const { discovered, scanned, complete } = data.manifest.coverage;
  if (discovered <= 0) return complete ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((scanned / discovered) * 100)));
}

export function projectMapConnections(
  data: ProjectMapData,
  entityId: string,
): {
  inbound: ProjectMapConnection[];
  outbound: ProjectMapConnection[];
} {
  const entities = new Map(data.entities.map((entity) => [entity.id, entity]));
  const inbound: ProjectMapConnection[] = [];
  const outbound: ProjectMapConnection[] = [];
  for (const relation of data.relations) {
    if (relation.to === entityId) {
      inbound.push({
        relation,
        neighbor: entities.get(relation.from) ?? null,
      });
    }
    if (relation.from === entityId) {
      outbound.push({
        relation,
        neighbor: entities.get(relation.to) ?? null,
      });
    }
  }
  const byName = (left: ProjectMapConnection, right: ProjectMapConnection) =>
    (left.neighbor?.name ?? left.relation.id).localeCompare(
      right.neighbor?.name ?? right.relation.id,
    );
  inbound.sort(byName);
  outbound.sort(byName);
  return { inbound, outbound };
}

const PROJECT_MAP_KIND_ORDER: KnowledgeEntityKind[] = [
  "project",
  "module",
  "scene",
  "prefab",
  "script",
  "type",
  "package",
];

const PROJECT_MAP_SCOPE_ORDER: Record<KnowledgeEntity["scope"], number> = {
  project: 0,
  "first-party": 1,
  package: 2,
  external: 3,
};

export function projectMapFacetCounts(
  entities: KnowledgeEntity[],
): Record<ProjectMapFacet, number> {
  const counts: Record<ProjectMapFacet, number> = {
    all: entities.length,
    project: 0,
    module: 0,
    scene: 0,
    prefab: 0,
    script: 0,
    type: 0,
    package: 0,
  };
  for (const entity of entities) counts[entity.kind] += 1;
  return counts;
}

export function filterProjectMapHits(
  hits: ProjectMapSearchHit[],
  facet: ProjectMapFacet,
): ProjectMapSearchHit[] {
  return facet === "all"
    ? hits
    : hits.filter(({ entity }) => entity.kind === facet);
}

export function groupProjectMapHits(
  hits: ProjectMapSearchHit[],
): ProjectMapHitGroup[] {
  const byKind = new Map<KnowledgeEntityKind, ProjectMapSearchHit[]>();
  for (const hit of hits) {
    const grouped = byKind.get(hit.entity.kind);
    if (grouped) grouped.push(hit);
    else byKind.set(hit.entity.kind, [hit]);
  }

  const groups: ProjectMapHitGroup[] = [];
  for (const kind of PROJECT_MAP_KIND_ORDER) {
    const grouped = byKind.get(kind);
    if (grouped) {
      groups.push({ kind, label: formatKnowledgeKind(kind), hits: grouped });
    }
  }
  return groups;
}

export function localProjectMapHits(
  entities: KnowledgeEntity[],
  query: string,
  limit = 80,
): ProjectMapSearchHit[] {
  const cappedLimit = Math.max(0, limit);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return entities
      .slice(0, cappedLimit)
      .map((entity) => ({ entity, score: 0 }));
  }

  const tokens = normalizedQuery.split(/\s+/);
  return entities
    .flatMap((entity) => {
      const name = entity.name.toLowerCase();
      const path = entity.path?.toLowerCase() ?? "";
      const metadata = [entity.kind, entity.scope];
      const facts = entity.facts.flatMap((fact) => [
        fact.key.toLowerCase(),
        formatKnowledgeFactValue(fact.value).toLowerCase(),
      ]);
      let score = 0;

      for (const token of tokens) {
        if (name === token) score += 400;
        else if (name.startsWith(token)) score += 300;
        else if (name.includes(token)) score += 200;
        else if (path.includes(token)) score += 100;
        else if (metadata.some((value) => value.includes(token))) score += 50;
        else if (facts.some((value) => value.includes(token))) score += 25;
        else return [];
      }

      if (name === normalizedQuery) score += 10_000;
      else if (name.startsWith(normalizedQuery)) score += 8_000;
      else if (name.includes(normalizedQuery)) score += 6_000;
      return [{ entity, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        PROJECT_MAP_SCOPE_ORDER[left.entity.scope] -
          PROJECT_MAP_SCOPE_ORDER[right.entity.scope] ||
        left.entity.id.localeCompare(right.entity.id),
    )
    .slice(0, cappedLimit);
}

export function projectMapChildren(
  data: ProjectMapData,
  entityId: string,
): KnowledgeEntity[] {
  const byId = new Map(data.entities.map((entity) => [entity.id, entity]));
  const children = new Map<string, KnowledgeEntity>();
  for (const relation of data.relations) {
    if (
      relation.from !== entityId ||
      (relation.kind !== "contains" && relation.kind !== "declares")
    ) {
      continue;
    }
    const child = byId.get(relation.to);
    if (child) children.set(child.id, child);
  }

  const kindOrder: KnowledgeEntityKind[] = [
    "module",
    "scene",
    "prefab",
    "script",
    "type",
    "package",
    "project",
  ];
  const kindPriority = new Map(kindOrder.map((kind, index) => [kind, index]));
  return [...children.values()].sort(
    (left, right) =>
      (kindPriority.get(left.kind) ?? kindOrder.length) -
        (kindPriority.get(right.kind) ?? kindOrder.length) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
}

export function projectMapBreadcrumbs(
  data: ProjectMapData,
  entityId: string,
): KnowledgeEntity[] {
  const byId = new Map(data.entities.map((entity) => [entity.id, entity]));
  const selected = byId.get(entityId);
  if (!selected) return [];

  const parents = new Map<string, Map<string, KnowledgeEntity>>();
  for (const relation of data.relations) {
    const child = byId.get(relation.to);
    const parent = byId.get(relation.from);
    if (
      !child ||
      !parent ||
      relation.kind !== (child.kind === "type" ? "declares" : "contains")
    ) {
      continue;
    }
    const candidates = parents.get(child.id);
    if (candidates) candidates.set(parent.id, parent);
    else parents.set(child.id, new Map([[parent.id, parent]]));
  }

  const compareParents = (left: KnowledgeEntity, right: KnowledgeEntity) =>
    PROJECT_MAP_SCOPE_ORDER[left.scope] -
      PROJECT_MAP_SCOPE_ORDER[right.scope] || left.id.localeCompare(right.id);

  const lineage = [selected];
  const visited = new Set([selected.id]);
  let current = selected;
  while (current.kind !== "project") {
    const parent = [...(parents.get(current.id)?.values() ?? [])]
      .sort(compareParents)
      .find((candidate) => !visited.has(candidate.id));
    if (!parent) break;
    lineage.push(parent);
    visited.add(parent.id);
    current = parent;
  }

  lineage.reverse();
  if (selected.kind !== "project" && lineage[0]?.kind !== "project") {
    const project =
      byId.get(data.manifest.project.id) ??
      data.entities.find((entity) => entity.kind === "project");
    if (project && !visited.has(project.id)) lineage.unshift(project);
  }
  return lineage;
}

export function pushProjectMapHistory(
  history: string[],
  index: number,
  id: string,
): { history: string[]; index: number } {
  if (history[index] === id) return { history, index };
  const nextHistory = [...history.slice(0, index + 1), id];
  return { history: nextHistory, index: nextHistory.length - 1 };
}

export function reconcileProjectMapHistory(
  history: string[],
  index: number,
  availableIds: Iterable<string>,
  selectedId: string | null,
): { history: string[]; index: number } {
  if (!selectedId) return { history: [], index: -1 };
  const available = new Set(availableIds);
  const nextHistory = history
    .slice(0, index + 1)
    .filter((id) => id !== selectedId && available.has(id));
  nextHistory.push(selectedId);
  return { history: nextHistory, index: nextHistory.length - 1 };
}

export function groupProjectMapFacts(
  facts: KnowledgeFact[],
): ProjectMapFactGroup[] {
  const groups = new Map<string, KnowledgeFact[]>();
  for (const fact of facts) {
    const grouped = groups.get(fact.key);
    if (grouped) grouped.push(fact);
    else groups.set(fact.key, [fact]);
  }
  return [...groups].map(([key, grouped]) => ({ key, facts: grouped }));
}

export function formatProjectMapRelation(
  kind: KnowledgeRelationKind,
  direction: "inbound" | "outbound",
): string {
  const labels: Record<
    KnowledgeRelationKind,
    Record<"inbound" | "outbound", string>
  > = {
    contains: { inbound: "Part of", outbound: "Contains" },
    declares: { inbound: "Declared in", outbound: "Declares" },
    derives: { inbound: "Derived by", outbound: "Inherits from" },
    references: { inbound: "Referenced by", outbound: "References" },
  };
  return labels[kind][direction];
}

export function formatKnowledgeFactValue(value: KnowledgeFact["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function formatKnowledgeKind(kind: KnowledgeEntity["kind"]): string {
  return kind === "script" ? "C# script" : kind;
}
