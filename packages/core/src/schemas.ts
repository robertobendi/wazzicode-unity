import { z } from "zod";

export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vector3 = z.infer<typeof Vector3Schema>;

export const TransformSchema = z.object({
  position: Vector3Schema,
  rotation: Vector3Schema,
  localScale: Vector3Schema,
  worldPosition: Vector3Schema.optional(),
});
export type TransformData = z.infer<typeof TransformSchema>;

export const ObjectReferenceSchema = z.object({
  referenceType: z.enum(["GameObject", "Component", "Asset", "ScriptableObject", "Missing"]),
  name: z.string().optional(),
  path: z.string().optional(),
  guid: z.string().optional(),
  fileId: z.string().optional(),
  type: z.string().optional(),
});
export type ObjectReference = z.infer<typeof ObjectReferenceSchema>;

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const SerializedFieldValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    PrimitiveSchema,
    Vector3Schema,
    ObjectReferenceSchema,
    z.array(SerializedFieldValueSchema),
    z.record(z.string(), SerializedFieldValueSchema),
  ])
);

export const ComponentSchema = z.object({
  type: z.string(),
  assembly: z.string().optional(),
  enabled: z.boolean().optional(),
  fields: z.record(z.string(), SerializedFieldValueSchema).optional(),
  isMissingScript: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
});
export type ComponentData = z.infer<typeof ComponentSchema>;

export const PrefabInfoSchema = z.object({
  isPrefabInstance: z.boolean(),
  isPrefabAsset: z.boolean().optional(),
  sourcePath: z.string().optional(),
  sourceGuid: z.string().optional(),
  hasOverrides: z.boolean().optional(),
});
export type PrefabInfo = z.infer<typeof PrefabInfoSchema>;

export const GameObjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  instanceId: z.number().int().optional(),
  activeSelf: z.boolean(),
  activeInHierarchy: z.boolean(),
  tag: z.string(),
  layer: z.string(),
  scene: z.string().optional(),
  prefab: PrefabInfoSchema.optional(),
  transform: TransformSchema,
  components: z.array(ComponentSchema),
  warnings: z.array(z.string()).optional(),
});
export type GameObjectData = z.infer<typeof GameObjectSchema>;

export const SceneSummarySchema = z.object({
  path: z.string(),
  name: z.string(),
  isLoaded: z.boolean(),
  isDirty: z.boolean(),
  rootCount: z.number().int(),
  buildIndex: z.number().int(),
});
export type SceneSummary = z.infer<typeof SceneSummarySchema>;

export interface SceneHierarchyNode {
  name: string;
  path: string;
  active: boolean;
  childCount: number;
  components?: string[];
  children?: SceneHierarchyNode[];
  warnings?: string[];
}

export const SceneHierarchyNodeSchema: z.ZodType<SceneHierarchyNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    active: z.boolean(),
    childCount: z.number().int(),
    components: z.array(z.string()).optional(),
    children: z.array(SceneHierarchyNodeSchema).optional(),
    warnings: z.array(z.string()).optional(),
  })
);

export const SceneHierarchySchema = z.object({
  scene: z.string(),
  roots: z.array(SceneHierarchyNodeSchema),
  totalObjects: z.number().int().optional(),
});
export type SceneHierarchy = z.infer<typeof SceneHierarchySchema>;

export const ConsoleLogSchema = z.object({
  type: z.enum(["Log", "Warning", "Error", "Assert", "Exception"]),
  message: z.string(),
  stackTrace: z.string().optional(),
  timestamp: z.number(),
});
export type ConsoleLog = z.infer<typeof ConsoleLogSchema>;

export const ConsoleLogsResultSchema = z.object({
  logs: z.array(ConsoleLogSchema),
  truncated: z.boolean(),
  bufferSize: z.number().int(),
  fallback: z.string().optional(),
});
export type ConsoleLogsResult = z.infer<typeof ConsoleLogsResultSchema>;

export const CompileErrorSchema = z.object({
  file: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  message: z.string(),
  type: z.enum(["error", "warning"]).optional(),
});
export type CompileError = z.infer<typeof CompileErrorSchema>;

export const CompileStatusSchema = z.object({
  isCompiling: z.boolean(),
  hasErrors: z.boolean(),
  errorCount: z.number().int(),
  warningCount: z.number().int(),
  errors: z.array(CompileErrorSchema).optional(),
  fallback: z.string().optional(),
});
export type CompileStatus = z.infer<typeof CompileStatusSchema>;

export const PackageRefSchema = z.object({
  name: z.string(),
  version: z.string(),
});
export type PackageRef = z.infer<typeof PackageRefSchema>;

export const ProjectSummarySchema = z.object({
  unityVersion: z.string(),
  projectPath: z.string(),
  productName: z.string().optional(),
  companyName: z.string().optional(),
  bundleIdentifier: z.string().optional(),
  renderPipeline: z.string().optional(),
  inputSystem: z.string().optional(),
  scriptingBackend: z.string().optional(),
  buildTarget: z.string().optional(),
  packages: z.array(PackageRefSchema).optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const SelectionInspectResultSchema = z.object({
  hasSelection: z.boolean(),
  selected: GameObjectSchema.optional(),
});
export type SelectionInspectResult = z.infer<typeof SelectionInspectResultSchema>;

export const OpenScenesResultSchema = z.object({
  scenes: z.array(SceneSummarySchema),
  activeScene: z.string().optional(),
});
export type OpenScenesResult = z.infer<typeof OpenScenesResultSchema>;

export const ScreenshotSourceSchema = z.enum(["game_view", "scene_view", "selected_object"]);
export type ScreenshotSource = z.infer<typeof ScreenshotSourceSchema>;

export const ScreenshotResultSchema = z.object({
  source: ScreenshotSourceSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.literal("image/png"),
  /** base64-encoded PNG bytes (without the data: URL prefix). */
  pngBase64: z.string().min(1),
  /** Absolute path of the auto-saved PNG, when persisted to .unity-vibe/screenshots/. */
  savedTo: z.string().optional(),
  /** Human-readable description of what was captured (camera name, object path, etc.). */
  subject: z.string().optional(),
  /** Camera used to capture, if applicable. */
  cameraName: z.string().optional(),
});
export type ScreenshotResult = z.infer<typeof ScreenshotResultSchema>;
