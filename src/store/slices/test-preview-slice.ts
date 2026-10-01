import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { PreviewResult } from "@/services/automation-service";

/**
 * One "Test result" dialog for the whole app. Any Test button (automation
 * cards, the detail page, the wizard) dispatches `showPreview`; a single host
 * mounted in the app layout renders it.
 */
interface TestPreviewState {
  open: boolean;
  preview: PreviewResult | null;
}

const initialState: TestPreviewState = { open: false, preview: null };

export const testPreviewSlice = createSlice({
  name: "testPreview",
  initialState,
  reducers: {
    showPreview(state, action: PayloadAction<PreviewResult>) {
      state.preview = action.payload;
      state.open = true;
    },
    setPreviewOpen(state, action: PayloadAction<boolean>) {
      state.open = action.payload;
    },
  },
});

export const { showPreview, setPreviewOpen } = testPreviewSlice.actions;
