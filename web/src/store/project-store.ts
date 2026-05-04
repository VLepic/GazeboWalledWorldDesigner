import { create } from "zustand";
import type { ProjectCommand } from "../domain/project-commands";
import {
  createEmptyProject,
  ensureProjectDefaults,
} from "../domain/project-model";
import type { Project } from "../domain/project-model";
import {
  cloneProject,
  parseProjectData,
  parseProjectJson,
  stringifyProject,
} from "../domain/project-serialization";
import type { ProjectParseResult } from "../domain/project-serialization";

export interface ProjectStoreState {
  project: Project;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isHistoryTransactionOpen: boolean;
  historyLength: number;
  futureLength: number;
  lastImportWarnings: string[];
  pastProjects: Project[];
  futureProjects: Project[];
  savedProjectJson: string;
  currentTransactionStartProject: Project | null;
  currentTransactionLabel: string | null;
  replaceProject: (project: Project, markDirty?: boolean) => void;
  applyCommand: (command: ProjectCommand) => void;
  beginHistoryTransaction: (label?: string) => void;
  commitHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
  undo: () => void;
  redo: () => void;
  resetProject: () => void;
  importProjectData: (data: unknown) => ProjectParseResult;
  importProjectJson: (source: string) => ProjectParseResult;
  exportProjectJson: (markSaved?: boolean) => string;
  markSaved: () => void;
}

const initialProject = ensureProjectDefaults(createEmptyProject());
const HISTORY_LIMIT = 100;

function normalizeProject(project: Project) {
  return cloneProject(ensureProjectDefaults(project));
}

function pushHistory(history: Project[], project: Project) {
  const nextHistory = [...history, normalizeProject(project)];
  return nextHistory.length > HISTORY_LIMIT
    ? nextHistory.slice(nextHistory.length - HISTORY_LIMIT)
    : nextHistory;
}

function isDirtyProject(project: Project, savedProjectJson: string) {
  return stringifyProject(project) !== savedProjectJson;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  project: normalizeProject(initialProject),
  isDirty: false,
  canUndo: false,
  canRedo: false,
  isHistoryTransactionOpen: false,
  historyLength: 0,
  futureLength: 0,
  lastImportWarnings: [],

  replaceProject: (project, markDirty = false) => {
    const state = get();
    const nextProject = normalizeProject(project);
    const savedProjectJson = markDirty
      ? state.savedProjectJson
      : stringifyProject(nextProject);
    const currentProjectJson = stringifyProject(state.project);
    const nextProjectJson = stringifyProject(nextProject);
    const pastProjects =
      currentProjectJson === nextProjectJson
        ? state.pastProjects
        : pushHistory(state.pastProjects, state.project);

    set({
      project: nextProject,
      isDirty: isDirtyProject(nextProject, savedProjectJson),
      canUndo: pastProjects.length > 0,
      canRedo: false,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: 0,
      lastImportWarnings: [],
      savedProjectJson,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects: [],
    });
  },

  applyCommand: (command) => {
    const state = get();
    const nextProject = normalizeProject(command(normalizeProject(state.project)));
    const nextProjectJson = stringifyProject(nextProject);
    const currentProjectJson = stringifyProject(state.project);

    if (nextProjectJson === currentProjectJson) {
      return;
    }

    if (state.currentTransactionStartProject) {
      set({
        project: nextProject,
        isDirty: nextProjectJson !== state.savedProjectJson,
      });
      return;
    }

    const pastProjects = pushHistory(state.pastProjects, state.project);
    set({
      project: nextProject,
      isDirty: nextProjectJson !== state.savedProjectJson,
      canUndo: pastProjects.length > 0,
      canRedo: false,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: 0,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects: [],
    });
  },

  beginHistoryTransaction: (label = "transaction") => {
    const state = get();
    if (state.currentTransactionStartProject) {
      return;
    }

    set({
      isHistoryTransactionOpen: true,
      currentTransactionStartProject: normalizeProject(state.project),
      currentTransactionLabel: label,
    });
  },

  commitHistoryTransaction: () => {
    const state = get();
    const startProject = state.currentTransactionStartProject;
    if (!startProject) {
      return;
    }

    const startProjectJson = stringifyProject(startProject);
    const currentProjectJson = stringifyProject(state.project);
    if (startProjectJson === currentProjectJson) {
      set({
        isHistoryTransactionOpen: false,
        currentTransactionStartProject: null,
        currentTransactionLabel: null,
      });
      return;
    }

    const pastProjects = pushHistory(state.pastProjects, startProject);
    set({
      isDirty: currentProjectJson !== state.savedProjectJson,
      canUndo: pastProjects.length > 0,
      canRedo: false,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: 0,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects: [],
    });
  },

  cancelHistoryTransaction: () => {
    const state = get();
    const startProject = state.currentTransactionStartProject;
    if (!startProject) {
      return;
    }

    set({
      project: normalizeProject(startProject),
      isDirty: isDirtyProject(startProject, state.savedProjectJson),
      isHistoryTransactionOpen: false,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
    });
  },

  undo: () => {
    const state = get();
    if (state.currentTransactionStartProject) {
      return;
    }

    const previousProject = state.pastProjects[state.pastProjects.length - 1];
    if (!previousProject) {
      return;
    }

    const pastProjects = state.pastProjects.slice(0, -1);
    const futureProjects = [normalizeProject(state.project), ...state.futureProjects];
    set({
      project: normalizeProject(previousProject),
      isDirty: isDirtyProject(previousProject, state.savedProjectJson),
      canUndo: pastProjects.length > 0,
      canRedo: futureProjects.length > 0,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: futureProjects.length,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects,
    });
  },

  redo: () => {
    const state = get();
    if (state.currentTransactionStartProject) {
      return;
    }

    const nextProject = state.futureProjects[0];
    if (!nextProject) {
      return;
    }

    const pastProjects = pushHistory(state.pastProjects, state.project);
    const futureProjects = state.futureProjects.slice(1);
    set({
      project: normalizeProject(nextProject),
      isDirty: isDirtyProject(nextProject, state.savedProjectJson),
      canUndo: pastProjects.length > 0,
      canRedo: futureProjects.length > 0,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: futureProjects.length,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects,
    });
  },

  resetProject: () => {
    const state = get();
    const nextProject = normalizeProject(initialProject);
    const savedProjectJson = stringifyProject(nextProject);
    const currentProjectJson = stringifyProject(state.project);
    const nextProjectJson = stringifyProject(nextProject);
    const pastProjects =
      currentProjectJson === nextProjectJson
        ? state.pastProjects
        : pushHistory(state.pastProjects, state.project);

    set({
      project: nextProject,
      isDirty: false,
      canUndo: pastProjects.length > 0,
      canRedo: false,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: 0,
      lastImportWarnings: [],
      savedProjectJson,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects: [],
    });
  },

  importProjectData: (data) => {
    const state = get();
    const result = parseProjectData(data);
    const nextProject = normalizeProject(result.project);
    const savedProjectJson = stringifyProject(nextProject);
    const currentProjectJson = stringifyProject(state.project);
    const nextProjectJson = stringifyProject(nextProject);
    const pastProjects =
      currentProjectJson === nextProjectJson
        ? state.pastProjects
        : pushHistory(state.pastProjects, state.project);

    set({
      project: nextProject,
      isDirty: false,
      canUndo: pastProjects.length > 0,
      canRedo: false,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: 0,
      lastImportWarnings: result.warnings,
      savedProjectJson,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects: [],
    });
    return result;
  },

  importProjectJson: (source) => {
    const state = get();
    const result = parseProjectJson(source);
    const nextProject = normalizeProject(result.project);
    const savedProjectJson = stringifyProject(nextProject);
    const currentProjectJson = stringifyProject(state.project);
    const nextProjectJson = stringifyProject(nextProject);
    const pastProjects =
      currentProjectJson === nextProjectJson
        ? state.pastProjects
        : pushHistory(state.pastProjects, state.project);

    set({
      project: nextProject,
      isDirty: false,
      canUndo: pastProjects.length > 0,
      canRedo: false,
      isHistoryTransactionOpen: false,
      historyLength: pastProjects.length,
      futureLength: 0,
      lastImportWarnings: result.warnings,
      savedProjectJson,
      currentTransactionStartProject: null,
      currentTransactionLabel: null,
      pastProjects,
      futureProjects: [],
    });
    return result;
  },

  exportProjectJson: (markSaved = true) => {
    const json = stringifyProject(get().project);
    if (markSaved) {
      set({ isDirty: false, savedProjectJson: json });
    }

    return json;
  },

  markSaved: () => {
    const savedProjectJson = stringifyProject(get().project);
    set({ isDirty: false, savedProjectJson });
  },

  pastProjects: [],
  futureProjects: [],
  savedProjectJson: stringifyProject(initialProject),
  currentTransactionStartProject: null,
  currentTransactionLabel: null,
}));
