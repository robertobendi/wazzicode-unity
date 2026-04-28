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

export const allTools: AnyToolDef[] = [
  unityProjectSummary as unknown as AnyToolDef,
  unityGenerateProjectBrain as unknown as AnyToolDef,
  unityGetOpenScenes as unknown as AnyToolDef,
  unityGetSceneHierarchy as unknown as AnyToolDef,
  unityInspectSelected as unknown as AnyToolDef,
  unityGetConsoleLogs as unknown as AnyToolDef,
  unityWaitForCompile as unknown as AnyToolDef,
  unityCheckGitStatus as unknown as AnyToolDef,
  unityCaptureGameView as unknown as AnyToolDef,
  unityCaptureSceneView as unknown as AnyToolDef,
  unityCaptureSelected as unknown as AnyToolDef,
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
};
