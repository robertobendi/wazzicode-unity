export {
  PACKAGE_NAME,
  readEditorPackageStatus,
  type EditorPackageStatus,
  type InstallMode,
} from "./status.js";
export {
  installUnityPackage,
  ensureEditorPackageCurrent,
  resolvePackageSource,
  UnityPackageInstallError,
  type InstallModeRequest,
  type InstallResult,
  type EnsureCurrentResult,
} from "./install.js";
