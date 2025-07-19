import { create } from "zustand";

interface GlobalStore {
  openSetting: boolean;
  openHistory: boolean;
  openKnowledge: boolean;
}

interface GlobalActions {
  setOpenSetting: (visible: boolean) => void;
  setOpenHistory: (visible: boolean) => void;
  setOpenKnowledge: (visible: boolean) => void;
}

export const useGlobalStore = create<GlobalStore & GlobalActions>((set) => ({
  openSetting: false,
  openHistory: false,
  openKnowledge: false,
  setOpenSetting: (visible) => set({ openSetting: visible }),
  setOpenHistory: (visible) => set({ openHistory: visible }),
  setOpenKnowledge: (visible) => set({ openKnowledge: visible }),
}));
