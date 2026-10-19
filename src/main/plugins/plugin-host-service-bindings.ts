import type { PluginEventName } from '../../shared/plugins/plugin-manifest'
import { PLUGIN_WORKSPACE_TERMINAL_LIMIT } from '../../shared/plugins/plugin-host-api'
import type { PluginHostServices } from './plugin-host-methods'
import { PluginSecretsStore } from './plugin-secrets-store'
import { PluginKvStore } from './plugin-storage-store'
import type { TerminalInputKind } from '../../shared/terminal-input-kind'
import type { ProjectGroup } from '../../shared/project-group-types'
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import type { Repo } from '../../shared/repo-types'

/** Structural subset of OrcaRuntimeService exposed to plugin facade bindings. */
export type PluginRuntimeDelegate = {
  resolveActiveWorktreeContext(): Promise<{
    worktreeId: string
    path: string
    branch: string
    displayName: string
  } | null>
  listTerminals(
    worktreeSelector?: string,
    limit?: number,
    opts?: { includeVisualLayouts?: boolean }
  ): Promise<{ terminals: { handle: string; title: string | null }[] }>
  sendTerminal(
    handle: string,
    action: { text?: string; enter?: boolean },
    options: { inputKind: TerminalInputKind }
  ): Promise<{ accepted: boolean }>
  dispatchPluginNotification(input: {
    pluginId: string
    title: string
    body?: string
  }): Promise<{ delivered: boolean }>
  listVisibleRepos(): Repo[]
  listVisibleProjectGroups(): ProjectGroup[]
  createProjectGroup(input: { name: string }): Promise<ProjectGroup>
  deleteProjectGroup(groupId: string): Promise<{ deleted: boolean }>
  moveProjectToGroup(repoSelector: string, groupId: string | null): Promise<Repo>
}

// Why: deleting a folder-backed group also removes its folder workspaces; plugins only manage manual groups.
function isFolderBackedGroup(group: ProjectGroup): boolean {
  return group.parentPath !== null || Boolean(group.connectionId)
}

export function bindPluginHostServices(input: {
  delegate: PluginRuntimeDelegate
  pluginsDataDir: string
  subscribeEvents: (pluginKey: string, events: PluginEventName[]) => PluginEventName[]
}): PluginHostServices {
  const { delegate, pluginsDataDir, subscribeEvents } = input
  return {
    resolveActiveWorktreeContext: async () => {
      const context = await delegate.resolveActiveWorktreeContext()
      if (!context) {
        return null
      }
      // Why: retain the internal id only for host-side terminal membership;
      // the public handler projects it out because it embeds provider paths.
      return {
        worktreeId: context.worktreeId,
        branch: context.branch,
        displayName: context.displayName
      }
    },
    listWorktreeTerminals: async (worktreeId) => {
      const result = await delegate.listTerminals(
        `id:${worktreeId}`,
        PLUGIN_WORKSPACE_TERMINAL_LIMIT,
        { includeVisualLayouts: false }
      )
      return result.terminals
        .slice(0, PLUGIN_WORKSPACE_TERMINAL_LIMIT)
        .map((terminal) => ({ id: terminal.handle }))
    },
    sendTerminalText: async (terminalId, action) => {
      const result = await delegate.sendTerminal(terminalId, action, { inputKind: 'driving' })
      return { accepted: result.accepted }
    },
    dispatchPluginNotification: (notification) => delegate.dispatchPluginNotification(notification),
    storage: {
      get: (key, itemKey) => new PluginKvStore(pluginsDataDir, key, 'storage.json').get(itemKey),
      set: (key, itemKey, value) =>
        new PluginKvStore(pluginsDataDir, key, 'storage.json').set(itemKey, value),
      delete: (key, itemKey) =>
        new PluginKvStore(pluginsDataDir, key, 'storage.json').delete(itemKey),
      keys: (key) => new PluginKvStore(pluginsDataDir, key, 'storage.json').keys()
    },
    secrets: {
      get: (key, itemKey) => new PluginSecretsStore(pluginsDataDir, key).get(itemKey),
      set: (key, itemKey, value) => new PluginSecretsStore(pluginsDataDir, key).set(itemKey, value),
      delete: (key, itemKey) => new PluginSecretsStore(pluginsDataDir, key).delete(itemKey)
    },
    settings: {
      getAll: (key) => new PluginKvStore(pluginsDataDir, key, 'settings.json').getAll(),
      set: (key, itemKey, value) =>
        new PluginKvStore(pluginsDataDir, key, 'settings.json').set(itemKey, value)
    },
    subscribeEvents,
    projects: {
      list: async () => ({
        groups: delegate.listVisibleProjectGroups().map((group) => ({
          id: group.id,
          name: group.name,
          folderBacked: isFolderBackedGroup(group)
        })),
        projects: delegate.listVisibleRepos().map((repo) => ({
          id: repo.id,
          displayName: repo.displayName,
          remoteKey: repo.gitRemoteIdentity?.canonicalKey ?? null,
          groupId: repo.projectGroupId ?? null
        }))
      }),
      createGroup: async (name) => ({ id: (await delegate.createProjectGroup({ name })).id }),
      deleteGroup: async (groupId) => {
        const groups = delegate.listVisibleProjectGroups()
        if (!groups.some((entry) => entry.id === groupId)) {
          return { deleted: false }
        }
        // Deletion cascades to nested groups, so one folder-backed descendant blocks it.
        const subtree = getProjectGroupSubtreeIds(groups, groupId)
        if (groups.some((entry) => subtree.has(entry.id) && isFolderBackedGroup(entry))) {
          throw new Error('folder-backed project groups cannot be deleted by plugins')
        }
        return delegate.deleteProjectGroup(groupId)
      },
      moveToGroup: async (projectId, groupId) => {
        await delegate.moveProjectToGroup(`id:${projectId}`, groupId)
      }
    }
  }
}
