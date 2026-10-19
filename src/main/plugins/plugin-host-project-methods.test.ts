import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import { bindPluginHostServices, type PluginRuntimeDelegate } from './plugin-host-service-bindings'
import { executePluginHostCall } from './plugin-host-methods'

function group(overrides: Partial<ProjectGroup>): ProjectGroup {
  return {
    id: 'g',
    name: 'Group',
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function harness() {
  const delegate: PluginRuntimeDelegate = {
    resolveActiveWorktreeContext: vi.fn(),
    listTerminals: vi.fn(),
    sendTerminal: vi.fn(),
    dispatchPluginNotification: vi.fn(),
    listVisibleRepos: vi.fn().mockReturnValue([
      {
        id: 'r1',
        path: '/Users/private/api',
        displayName: 'api',
        badgeColor: '#000',
        addedAt: 0,
        projectGroupId: 'manual',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/acme/api',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:acme/api.git'
        }
      } satisfies Repo
    ]),
    listVisibleProjectGroups: vi
      .fn()
      .mockReturnValue([
        group({ id: 'manual', name: 'Work' }),
        group({ id: 'folder', name: 'Scanned', parentPath: '/Users/private/src' }),
        group({ id: 'parent', name: 'Parent' }),
        group({ id: 'nested', name: 'Nested', parentGroupId: 'parent', connectionId: 'ssh-1' })
      ]),
    createProjectGroup: vi.fn(),
    deleteProjectGroup: vi.fn().mockResolvedValue({ deleted: true }),
    moveProjectToGroup: vi.fn()
  }
  const services = bindPluginHostServices({
    delegate,
    pluginsDataDir: join(tmpdir(), 'plugin-host-project-methods-test'),
    subscribeEvents: vi.fn().mockReturnValue([])
  })
  const call = (method: string, params?: unknown) =>
    executePluginHostCall({
      pluginId: 'orca-samples.demo',
      method,
      params,
      viaPanel: false,
      grantedCapabilities: ['projects:organize'],
      services,
      audit: { record: vi.fn().mockResolvedValue(undefined) }
    })
  return { delegate, call }
}

describe('plugin project catalog methods', () => {
  it('lists projects without paths or remote URLs', async () => {
    const { call } = harness()
    expect(await call('projects.list')).toEqual({
      ok: true,
      value: {
        groups: [
          { id: 'manual', name: 'Work', folderBacked: false },
          { id: 'folder', name: 'Scanned', folderBacked: true },
          { id: 'parent', name: 'Parent', folderBacked: false },
          { id: 'nested', name: 'Nested', folderBacked: true }
        ],
        projects: [
          { id: 'r1', displayName: 'api', remoteKey: 'github.com/acme/api', groupId: 'manual' }
        ]
      }
    })
  })

  it('refuses to delete folder-backed groups or their ancestors', async () => {
    const { delegate, call } = harness()
    expect(await call('projectGroups.delete', { groupId: 'folder' })).toMatchObject({
      ok: false,
      code: 'action_failed'
    })
    expect(await call('projectGroups.delete', { groupId: 'parent' })).toMatchObject({ ok: false })
    expect(delegate.deleteProjectGroup).not.toHaveBeenCalled()
    expect(await call('projectGroups.delete', { groupId: 'manual' })).toEqual({
      ok: true,
      value: { deleted: true }
    })
  })

  it('moves by repo id selector and requires the capability', async () => {
    const { delegate, call } = harness()
    await call('projects.moveToGroup', { projectId: 'r1', groupId: null })
    expect(delegate.moveProjectToGroup).toHaveBeenCalledWith('id:r1', null)
    const denied = await executePluginHostCall({
      pluginId: 'orca-samples.demo',
      method: 'projects.list',
      params: undefined,
      viaPanel: false,
      grantedCapabilities: ['storage'],
      services: null
    })
    expect(denied).toMatchObject({ ok: false, code: 'capability_denied' })
  })
})
