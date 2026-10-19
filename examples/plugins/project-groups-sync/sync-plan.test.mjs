// Run: node --test examples/plugins/project-groups-sync/sync-plan.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localLayout, mergeLayouts, planLocalChanges } from './sync-plan.mjs'

const catalog = {
  groups: [
    { id: 'g1', name: 'Work', folderBacked: false },
    { id: 'g2', name: 'Old', folderBacked: false },
    { id: 'gf', name: 'Scanned', folderBacked: true }
  ],
  projects: [
    { id: 'p1', displayName: 'api', remoteKey: 'github.com/acme/api', groupId: 'g1' },
    { id: 'p2', displayName: 'notes', remoteKey: null, groupId: 'g2' },
    { id: 'p3', displayName: 'scan', remoteKey: null, groupId: 'gf' },
    { id: 'p4', displayName: 'loose', remoteKey: null, groupId: null }
  ]
}

test('local layout skips folder-backed groups', () => {
  const { groups, present } = localLayout(catalog)
  assert.deepEqual(groups, { Work: ['github.com/acme/api'], Old: ['notes'] })
  assert.deepEqual([...present].sort(), ['github.com/acme/api', 'loose', 'notes'])
})

test('remote group delete sends its projects to default, keeps unknown projects', () => {
  const { groups, present } = localLayout(catalog)
  const base = { groups: { Work: ['github.com/acme/api', 'github.com/acme/web'], Old: ['notes'] } }
  const shared = { groups: { Work: ['github.com/acme/api', 'github.com/acme/web'] } }
  const target = mergeLayouts({ local: { groups }, present, shared, base })
  assert.deepEqual(target, { groups: { Work: ['github.com/acme/api', 'github.com/acme/web'] } })
  assert.deepEqual(planLocalChanges(catalog, target), {
    creations: [],
    moves: [{ projectId: 'p2', groupName: null }],
    deletions: ['g2']
  })
})

test('local move wins over unchanged shared; concurrent remote add is kept', () => {
  const base = { groups: { Work: ['github.com/acme/api'], Old: ['notes'] } }
  const local = { groups: { Work: ['github.com/acme/api', 'notes'], Old: [] } }
  const present = new Set(['github.com/acme/api', 'notes'])
  const shared = { groups: { Work: ['github.com/acme/api'], Old: ['notes'], New: ['x'] } }
  assert.deepEqual(mergeLayouts({ local, present, shared, base }), {
    groups: { Work: ['github.com/acme/api', 'notes'], Old: [], New: ['x'] }
  })
})

test('first run prefers the shared file and adds local-only groups', () => {
  const local = { groups: { Work: ['a'], Mine: ['b'] } }
  const shared = { groups: { Work: [], Team: ['a'] } }
  assert.deepEqual(mergeLayouts({ local, present: new Set(['a', 'b']), shared, base: null }), {
    groups: { Work: [], Team: ['a'], Mine: ['b'] }
  })
})
