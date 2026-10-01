import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Navigation state of the automation wizard. Field values live in react-hook-form. */
interface WizardState {
  step: number;
  stepCount: number;
  activate: boolean;
  testing: boolean;
}

const initialState: WizardState = { step: 0, stepCount: 1, activate: true, testing: false };

export const wizardSlice = createSlice({
  name: "wizard",
  initialState,
  reducers: {
    startWizard(_state, action: PayloadAction<{ stepCount: number }>) {
      return { ...initialState, stepCount: action.payload.stepCount };
    },
    nextStep(state) {
      state.step = Math.min(state.step + 1, state.stepCount - 1);
    },
    previousStep(state) {
      state.step = Math.max(state.step - 1, 0);
    },
    goToStep(state, action: PayloadAction<number>) {
      state.step = Math.min(Math.max(action.payload, 0), state.stepCount - 1);
    },
    setActivate(state, action: PayloadAction<boolean>) {
      state.activate = action.payload;
    },
    setTesting(state, action: PayloadAction<boolean>) {
      state.testing = action.payload;
    },
  },
});

export const { startWizard, nextStep, previousStep, goToStep, setActivate, setTesting } = wizardSlice.actions;
