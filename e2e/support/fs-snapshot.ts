import { hashElement, type HashElementNode } from 'folder-hash'

/**
 * A hash tree of every file and folder under `root` (names and contents,
 * including `.git`), for checking that nothing changed.
 */
export function snapshotTree(root: string): Promise<HashElementNode> {
  return hashElement(root, { algo: 'sha256', encoding: 'hex' })
}
