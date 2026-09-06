/** View settings owned by the host, separate from drawing content. */
export interface DrawingPreferences {
  gridVisible: boolean;
  snap: boolean;
  smartGuidesEnabled: boolean;
}

export const DEFAULT_DRAWING_PREFERENCES: DrawingPreferences = {
  gridVisible: true,
  snap: false,
  smartGuidesEnabled: true,
};
