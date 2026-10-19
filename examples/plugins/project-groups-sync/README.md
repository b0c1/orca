# Project Groups Sync

Mirrors Orca's project groups to `~/.orca/project-groups.json` and back.

- Drag projects between groups in the sidebar as usual; the file updates.
- Edit the file by hand, then run **Project Groups: Sync Now** (or change anything in the sidebar).
- Deleting a group moves its projects to the default (ungrouped) section, on every device.

```json
{
  "syncFile": "D:/OneDrive/orca/project-groups.json",
  "groups": {
    "Work": ["github.com/acme/api", "github.com/acme/web"],
    "Personal": ["notes"]
  }
}
```

Projects are matched by git remote (`host/owner/repo`), or by display name when there is none.

To sync between devices, set `syncFile` on each device to a file inside a folder that is
already synced (OneDrive, Dropbox, iCloud Drive, a git checkout). The groups then live in that
file instead of the local one. Changes made on both devices since the last sync are merged;
a group deleted on either side is deleted everywhere.

Groups imported from a folder or SSH root are device-specific and are left untouched.
