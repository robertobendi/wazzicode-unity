import { AnyToolDef } from "../registry.js";
import { unityProjectSummary } from "./unityProjectSummary.js";
import { unityGenerateProjectBrain } from "./unityGenerateProjectBrain.js";
import { unityGetOpenScenes } from "./unityGetOpenScenes.js";
import { unityGetSceneHierarchy } from "./unityGetSceneHierarchy.js";
import { unityInspectSelected } from "./unityInspectSelected.js";
import { unityGetConsoleLogs } from "./unityGetConsoleLogs.js";
import { unityWaitForCompile } from "./unityWaitForCompile.js";
import { unityCheckGitStatus } from "./unityCheckGitStatus.js";
import { unityCaptureGameView } from "./unityCaptureGameView.js";
import { unityCaptureSceneView } from "./unityCaptureSceneView.js";
import { unityCaptureSelected } from "./unityCaptureSelected.js";
import { unityGetPerformanceStats } from "./unityGetPerformanceStats.js";
import { unityRunTests } from "./unityRunTests.js";
import {
  unityEnterPlayMode,
  unityExitPlayMode,
  unityStepFrame,
  unityGetPlayModeStatus,
} from "./unityPlayMode.js";
import { unityFindRuntimeObjects, unityInspectRuntimeObject } from "./unityRuntime.js";
import {
  unityFindMissingScripts,
  unityFindMissingReferences,
  unityFindDependencies,
  unityFindReferences,
} from "./unityAssetGraph.js";
import {
  unitySetSerializedField,
  unityAddComponent,
  unityCreateGameObject,
  unitySaveScene,
  unityAssignReference,
  unityWireUiButton,
  unityInstantiatePrefab,
  unityCreateScriptableObject,
  unityCreateMaterial,
  unityCreatePrefabVariant,
  unityClearConsole,
} from "./unityEdit.js";
import { unityOpenScene, unityLoadSceneAdditive } from "./unityScene.js";
import { unitySetTransform, unityReparent } from "./unityLayout.js";
import { unityOpenPrefab, unitySavePrefab, unityApplyPrefabInstance } from "./unityPrefab.js";
import { unitySimulateInput } from "./unitySimulateInput.js";
import {
  unityGetAnimatorState,
  unitySetAnimatorParameter,
  unityAnimatorEditTransition,
} from "./unityAnimator.js";
import { unityExecuteMenuItem } from "./unityMenu.js";
import { unityImportAsset, unitySliceSprite } from "./unityAsset.js";
import { unityPaintTilemap } from "./unityTilemap.js";

export const allTools: AnyToolDef[] = [
  // Context / inspection
  unityProjectSummary as unknown as AnyToolDef,
  unityGenerateProjectBrain as unknown as AnyToolDef,
  unityGetOpenScenes as unknown as AnyToolDef,
  unityGetSceneHierarchy as unknown as AnyToolDef,
  unityInspectSelected as unknown as AnyToolDef,
  unityGetConsoleLogs as unknown as AnyToolDef,
  unityWaitForCompile as unknown as AnyToolDef,
  unityCheckGitStatus as unknown as AnyToolDef,
  // Visual
  unityCaptureGameView as unknown as AnyToolDef,
  unityCaptureSceneView as unknown as AnyToolDef,
  unityCaptureSelected as unknown as AnyToolDef,
  // Performance
  unityGetPerformanceStats as unknown as AnyToolDef,
  // Tests
  unityRunTests as unknown as AnyToolDef,
  // Play mode + runtime
  unityEnterPlayMode as unknown as AnyToolDef,
  unityExitPlayMode as unknown as AnyToolDef,
  unityStepFrame as unknown as AnyToolDef,
  unityGetPlayModeStatus as unknown as AnyToolDef,
  unityFindRuntimeObjects as unknown as AnyToolDef,
  unityInspectRuntimeObject as unknown as AnyToolDef,
  // Asset / reference graph
  unityFindMissingScripts as unknown as AnyToolDef,
  unityFindMissingReferences as unknown as AnyToolDef,
  unityFindDependencies as unknown as AnyToolDef,
  unityFindReferences as unknown as AnyToolDef,
  // Scene navigation (non-write)
  unityOpenScene as unknown as AnyToolDef,
  unityLoadSceneAdditive as unknown as AnyToolDef,
  unityOpenPrefab as unknown as AnyToolDef,
  // Play-test + animation
  unitySimulateInput as unknown as AnyToolDef,
  unityGetAnimatorState as unknown as AnyToolDef,
  unitySetAnimatorParameter as unknown as AnyToolDef,
  // Write (safety-gated)
  unitySetSerializedField as unknown as AnyToolDef,
  unitySetTransform as unknown as AnyToolDef,
  unityReparent as unknown as AnyToolDef,
  unityAddComponent as unknown as AnyToolDef,
  unityCreateGameObject as unknown as AnyToolDef,
  unitySaveScene as unknown as AnyToolDef,
  unityAssignReference as unknown as AnyToolDef,
  unityWireUiButton as unknown as AnyToolDef,
  unityInstantiatePrefab as unknown as AnyToolDef,
  unityPaintTilemap as unknown as AnyToolDef,
  unitySavePrefab as unknown as AnyToolDef,
  unityApplyPrefabInstance as unknown as AnyToolDef,
  unityCreateScriptableObject as unknown as AnyToolDef,
  unityCreateMaterial as unknown as AnyToolDef,
  unityImportAsset as unknown as AnyToolDef,
  unitySliceSprite as unknown as AnyToolDef,
  unityCreatePrefabVariant as unknown as AnyToolDef,
  unityAnimatorEditTransition as unknown as AnyToolDef,
  unityExecuteMenuItem as unknown as AnyToolDef,
  unityClearConsole as unknown as AnyToolDef,
];

export {
  unityProjectSummary,
  unityGenerateProjectBrain,
  unityGetOpenScenes,
  unityGetSceneHierarchy,
  unityInspectSelected,
  unityGetConsoleLogs,
  unityWaitForCompile,
  unityCheckGitStatus,
  unityCaptureGameView,
  unityCaptureSceneView,
  unityCaptureSelected,
  unityGetPerformanceStats,
  unityRunTests,
  unityEnterPlayMode,
  unityExitPlayMode,
  unityStepFrame,
  unityGetPlayModeStatus,
  unityFindRuntimeObjects,
  unityInspectRuntimeObject,
  unityFindMissingScripts,
  unityFindMissingReferences,
  unityFindDependencies,
  unityFindReferences,
  unitySetSerializedField,
  unityAddComponent,
  unityCreateGameObject,
  unitySaveScene,
  unityAssignReference,
  unityWireUiButton,
  unityInstantiatePrefab,
  unityCreateScriptableObject,
  unityCreateMaterial,
  unityCreatePrefabVariant,
  unityClearConsole,
  unityOpenScene,
  unityLoadSceneAdditive,
  unitySetTransform,
  unityReparent,
  unityOpenPrefab,
  unitySavePrefab,
  unityApplyPrefabInstance,
  unitySimulateInput,
  unityGetAnimatorState,
  unitySetAnimatorParameter,
  unityAnimatorEditTransition,
  unityExecuteMenuItem,
  unityImportAsset,
  unitySliceSprite,
  unityPaintTilemap,
};
