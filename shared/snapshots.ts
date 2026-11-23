export const automaticSnapshotLimit = 4

export type Snapshot = {
  id: string
  note: string
  createdAt: string
  fileCount: number
  kind: 'automatic' | 'manual'
}
