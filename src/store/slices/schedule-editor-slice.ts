import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Whether the commit-schedule page shows the list or the create/edit form. */
type ScheduleEditorState = { mode: "list"; scheduleId: null } | { mode: "create"; scheduleId: null } | { mode: "edit"; scheduleId: string };

const initialState = { mode: "list", scheduleId: null } as ScheduleEditorState;

export const scheduleEditorSlice = createSlice({
  name: "scheduleEditor",
  initialState,
  reducers: {
    showScheduleList: () => ({ mode: "list", scheduleId: null }) as ScheduleEditorState,
    createSchedule: () => ({ mode: "create", scheduleId: null }) as ScheduleEditorState,
    editSchedule: (_state, action: PayloadAction<string>) =>
      ({ mode: "edit", scheduleId: action.payload }) as ScheduleEditorState,
  },
});

export const { showScheduleList, createSchedule, editSchedule } = scheduleEditorSlice.actions;
