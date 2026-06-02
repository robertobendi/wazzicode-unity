export const PRODUCT_NAME = "Unity Vibe OS";
export const PRODUCT_VERSION = "0.3.0";
export const PROTOCOL_VERSION = "1.0";
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 38578;
export const DEFAULT_MCP_PORT = 38577;

/**
 * Discovery file written by the Unity bridge on start, relative to the project root.
 * Lives under Library/ (Unity-ignored, per-machine) so the MCP server can find the
 * actual bound port and verify project identity even when the port was auto-selected
 * (e.g. a second Unity Editor instance fell back to a different port).
 */
export const BRIDGE_DISCOVERY_REL = "Library/UnityVibeOS/bridge.json";

export interface BridgeDiscovery {
  port: number;
  host: string;
  projectPath: string;
  unityVersion: string;
  pid: number;
  protocolVersion: string;
  startedAt: number;
}
