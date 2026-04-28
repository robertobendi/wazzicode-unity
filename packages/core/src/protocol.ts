import { PROTOCOL_VERSION } from "./version.js";

export const BRIDGE_METHODS = {
  systemHealth: "system.health",
  systemSummary: "system.summary",
  sceneGetOpenScenes: "scene.getOpenScenes",
  sceneGetHierarchy: "scene.getHierarchy",
  selectionInspect: "selection.inspect",
  consoleGetLogs: "console.getLogs",
  consoleClear: "console.clear",
  compileStatus: "compile.status",
  screenshotGameView: "screenshot.gameView",
  screenshotSceneView: "screenshot.sceneView",
  screenshotSelected: "screenshot.selected",
} as const;

export type BridgeMethod = (typeof BRIDGE_METHODS)[keyof typeof BRIDGE_METHODS];

export interface BridgeRequest<P = Record<string, unknown>> {
  id: string;
  version: string;
  method: BridgeMethod;
  params: P;
}

export interface BridgeResponseMeta {
  unityVersion: string;
  projectPath: string;
  durationMs: number;
}

export interface BridgeResponseOk<T = unknown> {
  id: string;
  ok: true;
  result: T;
  error: null;
  meta: BridgeResponseMeta;
}

export interface BridgeResponseErr {
  id: string;
  ok: false;
  result: null;
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: Partial<BridgeResponseMeta>;
}

export type BridgeResponse<T = unknown> = BridgeResponseOk<T> | BridgeResponseErr;

export function makeBridgeRequest<P extends Record<string, unknown>>(
  method: BridgeMethod,
  params?: P
): BridgeRequest<P> {
  return {
    id: randomId(),
    version: PROTOCOL_VERSION,
    method,
    params: (params ?? ({} as P)) as P,
  };
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
