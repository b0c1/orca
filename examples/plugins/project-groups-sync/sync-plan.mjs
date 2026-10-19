// Pure three-way merge of project-group layouts. A layout is
// { groups: { [groupName]: projectKey[] } }; unlisted projects sit in the
// default (ungrouped) section.

/** Device-independent project key: git remote when known, else display name. */
export function projectKey(project) {
  return project.remoteKey ?? project.displayName
}

/** Local layout from `projects.list`; folder-backed groups and their projects are left alone. */
export function localLayout(catalog) {
  const nameById = new Map()
  const groups = {}
  for (const group of catalog.groups) {
    if (group.folderBacked) {
      continue
    }
    nameById.set(group.id, group.name)
    groups[group.name] ??= []
  }
  const present = new Set()
  for (const project of catalog.projects) {
    if (project.groupId !== null && !nameById.has(project.groupId)) {
      continue
    }
    const key = projectKey(project)
    present.add(key)
    if (project.groupId !== null) {
      groups[nameById.get(project.groupId)].push(key)
    }
  }
  return { groups: sortLayout(groups).groups, present }
}

export function normalizeLayout(raw) {
  const groups = {}
  if (raw && typeof raw.groups === 'object' && raw.groups !== null && !Array.isArray(raw.groups)) {
    for (const [name, keys] of Object.entries(raw.groups)) {
      const trimmed = name.trim()
      if (!trimmed) {
        continue
      }
      groups[trimmed] = Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []
    }
  }
  return sortLayout(groups)
}

function sortLayout(groups) {
  const out = {}
  for (const [name, keys] of Object.entries(groups)) {
    out[name] = [...new Set(keys)].sort()
  }
  return { groups: out }
}

function assignments(layout) {
  const map = new Map()
  if (!layout) {
    return map
  }
  for (const [name, keys] of Object.entries(layout.groups)) {
    for (const key of keys) {
      map.set(key, name)
    }
  }
  return map
}

export function sameLayout(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Merge local edits, the shared file, and the last synced base. A change on
 * either side since `base` wins; with no base (first run on a device) the
 * shared file wins and local-only groups/assignments are added. Projects whose
 * group no longer exists fall back to the default group. Projects this device
 * does not have keep their shared assignment.
 */
export function mergeLayouts({ local, present, shared, base }) {
  const localNames = new Set(Object.keys(local.groups))
  const sharedNames = new Set(Object.keys(shared?.groups ?? {}))
  const baseNames = base ? new Set(Object.keys(base.groups)) : null

  const names = []
  for (const name of [...sharedNames, ...localNames]) {
    if (names.includes(name)) {
      continue
    }
    const inLocal = localNames.has(name)
    const inShared = sharedNames.has(name)
    const inBase = baseNames?.has(name) ?? false
    // Kept by both, or added on one side; a delete on either side wins.
    if (!baseNames || (inLocal && inShared) || (!inBase && (inLocal || inShared))) {
      names.push(name)
    }
  }

  const localMap = assignments(local)
  const sharedMap = assignments(shared)
  const baseMap = assignments(base)
  const groups = Object.fromEntries(names.map((name) => [name, []]))
  for (const key of new Set([...localMap.keys(), ...sharedMap.keys(), ...present])) {
    const baseValue = baseMap.get(key) ?? null
    const sharedValue = sharedMap.get(key) ?? null
    // A project missing on this device has no local opinion.
    const localValue = present.has(key) ? (localMap.get(key) ?? null) : baseValue
    const value = base
      ? localValue !== baseValue
        ? localValue
        : sharedValue
      : (sharedValue ?? localValue)
    if (value !== null && groups[value]) {
      groups[value].push(key)
    }
  }
  return sortLayout(groups)
}

/** Host calls that make the local catalog match `target`. */
export function planLocalChanges(catalog, target) {
  const groupIdByName = new Map()
  const deletions = []
  for (const group of catalog.groups) {
    if (group.folderBacked) {
      continue
    }
    if (!(group.name in target.groups) || groupIdByName.has(group.name)) {
      deletions.push(group.id)
    } else {
      groupIdByName.set(group.name, group.id)
    }
  }
  const creations = Object.keys(target.groups).filter((name) => !groupIdByName.has(name))
  const targetGroupByKey = assignments(target)
  const folderBackedIds = new Set(catalog.groups.filter((g) => g.folderBacked).map((g) => g.id))
  const moves = []
  for (const project of catalog.projects) {
    if (project.groupId !== null && folderBackedIds.has(project.groupId)) {
      continue
    }
    const currentName =
      project.groupId === null
        ? null
        : (catalog.groups.find((group) => group.id === project.groupId)?.name ?? null)
    const wanted = targetGroupByKey.get(projectKey(project)) ?? null
    // Duplicate-named groups are merged into the first one, so move their members too.
    const onSurvivor =
      project.groupId === null || groupIdByName.get(currentName) === project.groupId
    if (wanted !== currentName || !onSurvivor) {
      moves.push({ projectId: project.id, groupName: wanted })
    }
  }
  return { creations, moves, deletions }
}
