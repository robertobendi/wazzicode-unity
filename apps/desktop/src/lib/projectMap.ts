import type {
  KnowledgeEntity,
  KnowledgeFact,
  KnowledgeRelation,
  ProjectMapData,
} from "@/types/projectMap";

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

export function formatKnowledgeFactValue(value: KnowledgeFact["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function formatKnowledgeKind(kind: KnowledgeEntity["kind"]): string {
  return kind === "script" ? "C# script" : kind;
}
