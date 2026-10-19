import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  localLayout,
  mergeLayouts,
  normalizeLayout,
  planLocalChanges,
  sameLayout
} from './sync-plan.mjs'

// Holds the groups, or a `syncFile` pointer to a shared copy (OneDrive, Dropbox, a git checkout...).
const CONFIG_PATH = join(homedir(), '.orca', 'project-groups.json')
const BASE_KEY = 'lastSynced'

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

async function syncOnce(orca) {
  const config = await readJson(CONFIG_PATH)
  const sharedPath =
    typeof config?.syncFile === 'string' && config.syncFile.trim() ? config.syncFile : CONFIG_PATH
  const sharedRaw = sharedPath === CONFIG_PATH ? config : await readJson(sharedPath)
  const shared = sharedRaw ? normalizeLayout(sharedRaw) : null
  const storedBase = (await orca.host.call('storage.get', { key: BASE_KEY }))?.value
  const base = storedBase ? normalizeLayout(storedBase) : null

  const catalog = await orca.host.call('projects.list')
  const { groups, present } = localLayout(catalog)
  const target = mergeLayouts({ local: { groups }, present, shared, base })

  if (!shared || !sameLayout(target, shared)) {
    // Keep unrelated keys (e.g. syncFile) when the config file is also the shared file.
    await writeJsonAtomic(sharedPath, { ...sharedRaw, groups: target.groups })
  }

  const plan = planLocalChanges(catalog, target)
  const idByName = new Map()
  for (const group of catalog.groups) {
    // First of duplicate-named groups survives, matching planLocalChanges.
    if (!group.folderBacked && !idByName.has(group.name)) {
      idByName.set(group.name, group.id)
    }
  }
  for (const name of plan.creations) {
    idByName.set(name, (await orca.host.call('projectGroups.create', { name })).id)
  }
  for (const move of plan.moves) {
    const groupId = move.groupName === null ? null : idByName.get(move.groupName)
    await orca.host.call('projects.moveToGroup', { projectId: move.projectId, groupId })
  }
  // Deleting a group drops its remaining projects into the default group.
  for (const groupId of plan.deletions) {
    await orca.host.call('projectGroups.delete', { groupId })
  }
  await orca.host.call('storage.set', { key: BASE_KEY, value: target })
  return {
    sharedPath,
    created: plan.creations.length,
    moved: plan.moves.length,
    deleted: plan.deletions.length
  }
}

export default function activate(orca) {
  // Our own writes re-fire projects.changed; serialize and coalesce so they settle as a no-op.
  let running = null
  let rerun = false
  const sync = () => {
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      try {
        let result
        do {
          rerun = false
          result = await syncOnce(orca)
        } while (rerun)
        return result
      } finally {
        running = null
      }
    })()
    return running
  }
  const syncAndReport = () =>
    sync().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      orca.log(`sync failed: ${message}`)
      await orca.host
        .call('notifications.show', { title: 'Project group sync failed', body: message })
        .catch(() => undefined)
    })

  orca.events.on('projects.changed', syncAndReport)
  orca.commands.register('project-groups-sync-now', async () => {
    const result = await sync()
    orca.log(`synced with ${result.sharedPath}`)
    return result
  })
}
