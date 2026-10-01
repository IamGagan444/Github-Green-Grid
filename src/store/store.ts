import { combineReducers, configureStore } from "@reduxjs/toolkit";

import { scheduleEditorSlice } from "@/store/slices/schedule-editor-slice";
import { testPreviewSlice } from "@/store/slices/test-preview-slice";
import { wizardSlice } from "@/store/slices/wizard-slice";

/**
 * Client-side UI state only. Server data comes from Server Components (props
 * rendered on the server) or TanStack Query (cached API reads); it is never
 * copied into this store.
 */
const rootReducer = combineReducers({
  [testPreviewSlice.name]: testPreviewSlice.reducer,
  [wizardSlice.name]: wizardSlice.reducer,
  [scheduleEditorSlice.name]: scheduleEditorSlice.reducer,
});

/** A new store per browser session (and per request during SSR) — never a module singleton. */
export function makeStore() {
  return configureStore({ reducer: rootReducer });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = AppStore["dispatch"];
