import { BridgeMethod, BridgeResponse } from "@uvibe/core";
import { BridgeClient } from "./bridgeClient.js";
import { makeMockPng } from "./mockPng.js";

export function createMockBridgeClient(): BridgeClient {
  const meta = {
    unityVersion: "2022.3.42f1 (mock)",
    projectPath: "/mock/project",
    durationMs: 3,
  };

  const responders: Partial<Record<BridgeMethod, () => unknown>> = {
    "system.health": () => ({ status: "ok", uptime: 12345 }),

    "system.summary": () => ({
      unityVersion: "2022.3.42f1",
      projectPath: "/mock/project",
      productName: "MockGame",
      companyName: "MockStudio",
      bundleIdentifier: "com.mockstudio.mockgame",
      renderPipeline: "Universal",
      inputSystem: "InputSystem",
      scriptingBackend: "Mono",
      buildTarget: "StandaloneOSX",
      packages: [
        { name: "com.unity.render-pipelines.universal", version: "14.0.11" },
        { name: "com.unity.inputsystem", version: "1.7.0" },
        { name: "com.unity.textmeshpro", version: "3.0.6" },
      ],
    }),

    "scene.getOpenScenes": () => ({
      scenes: [
        {
          path: "Assets/Scenes/Sample.unity",
          name: "Sample",
          isLoaded: true,
          isDirty: false,
          rootCount: 4,
          buildIndex: 0,
        },
      ],
      activeScene: "Assets/Scenes/Sample.unity",
    }),

    "scene.getHierarchy": () => ({
      scene: "Assets/Scenes/Sample.unity",
      totalObjects: 6,
      roots: [
        {
          name: "Main Camera",
          path: "/Main Camera",
          active: true,
          childCount: 0,
          components: ["Transform", "Camera", "AudioListener"],
        },
        {
          name: "Directional Light",
          path: "/Directional Light",
          active: true,
          childCount: 0,
          components: ["Transform", "Light"],
        },
        {
          name: "Gameplay",
          path: "/Gameplay",
          active: true,
          childCount: 1,
          components: ["Transform"],
          children: [
            {
              name: "Player",
              path: "/Gameplay/Player",
              active: true,
              childCount: 1,
              components: ["Transform", "PlayerController", "Rigidbody"],
              children: [
                {
                  name: "WeaponSocket",
                  path: "/Gameplay/Player/WeaponSocket",
                  active: true,
                  childCount: 0,
                  components: ["Transform"],
                },
              ],
            },
          ],
        },
        {
          name: "EventSystem",
          path: "/EventSystem",
          active: true,
          childCount: 0,
          components: ["Transform", "EventSystem", "StandaloneInputModule"],
        },
      ],
    }),

    "selection.inspect": () => ({
      hasSelection: true,
      selected: {
        name: "Player",
        path: "/Gameplay/Player",
        instanceId: 1234,
        activeSelf: true,
        activeInHierarchy: true,
        tag: "Player",
        layer: "Default",
        scene: "Assets/Scenes/Sample.unity",
        prefab: {
          isPrefabInstance: true,
          sourcePath: "Assets/Prefabs/Player.prefab",
          hasOverrides: true,
        },
        transform: {
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          localScale: { x: 1, y: 1, z: 1 },
        },
        components: [
          {
            type: "Transform",
            assembly: "UnityEngine.CoreModule",
            fields: {
              localPosition: { x: 0, y: 1, z: 0 },
              localEulerAngles: { x: 0, y: 0, z: 0 },
              localScale: { x: 1, y: 1, z: 1 },
            },
          },
          {
            type: "PlayerController",
            assembly: "Assembly-CSharp",
            enabled: true,
            fields: {
              moveSpeed: 7.5,
              dashForce: 18,
              weaponController: {
                referenceType: "GameObject",
                path: "/Gameplay/Player/WeaponSocket",
                name: "WeaponSocket",
              },
              currentWeapon: {
                referenceType: "Missing",
                name: null,
              },
            },
          },
          {
            type: "Rigidbody",
            assembly: "UnityEngine.PhysicsModule",
            fields: {
              mass: 1,
              drag: 0,
              useGravity: true,
              isKinematic: false,
            },
          },
        ],
        warnings: ["currentWeapon is null"],
      },
    }),

    "console.getLogs": () => ({
      logs: [
        {
          type: "Log",
          message: "Mock log emitted at startup",
          timestamp: Date.now() - 5000,
        },
        {
          type: "Warning",
          message: "Mock warning: missing reference detected on Player.currentWeapon",
          timestamp: Date.now() - 2000,
        },
      ],
      truncated: false,
      bufferSize: 2,
    }),

    "compile.status": () => ({
      isCompiling: false,
      hasErrors: false,
      errorCount: 0,
      warningCount: 0,
      errors: [],
    }),

    "screenshot.gameView": () => {
      const img = makeMockPng(512, 288, [40, 100, 180], "MOCK GAME VIEW");
      return {
        source: "game_view",
        width: img.width,
        height: img.height,
        mimeType: "image/png",
        pngBase64: img.pngBase64,
        cameraName: "Main Camera (mock)",
        subject: "Camera.main",
      };
    },
    "screenshot.sceneView": () => {
      const img = makeMockPng(512, 288, [70, 150, 90], "MOCK SCENE VIEW");
      return {
        source: "scene_view",
        width: img.width,
        height: img.height,
        mimeType: "image/png",
        pngBase64: img.pngBase64,
        cameraName: "SceneView (mock)",
        subject: "SceneView.lastActiveSceneView",
      };
    },
    "screenshot.selected": () => {
      const img = makeMockPng(384, 384, [180, 100, 40], "MOCK SELECTED");
      return {
        source: "selected_object",
        width: img.width,
        height: img.height,
        mimeType: "image/png",
        pngBase64: img.pngBase64,
        cameraName: "TempCamera",
        subject: "/Gameplay/Player",
      };
    },
  };

  async function call<T>(
    method: BridgeMethod,
    _params: Record<string, unknown> = {}
  ): Promise<BridgeResponse<T>> {
    const responder = responders[method];
    if (!responder) {
      return {
        id: "mock",
        ok: false,
        result: null,
        error: {
          code: "TOOL_NOT_IMPLEMENTED",
          message: `Mock bridge has no responder for ${method}`,
        },
        meta: {},
      };
    }
    return {
      id: "mock",
      ok: true,
      result: responder() as T,
      error: null,
      meta,
    };
  }

  async function isConnected(): Promise<boolean> {
    return true;
  }

  return { source: "mock", call, isConnected };
}
