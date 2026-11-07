export const PACKAGE_PATH_DRAG_TYPE = "application/x-maca-package-path";
export const PACKAGE_PATH_POINTER_DROP = "maca-package-path-pointer-drop";

export interface PackagePathPointerDrop {
  path: string;
  x: number;
  y: number;
}
