export type DropMediaKind = 'image' | 'gif';

/** Give attached media a useful accessible name even when a drop also includes a note. */
export function getDropMediaAccessibleName(kind: DropMediaKind) {
  return kind === 'gif' ? 'Attached GIF' : 'Attached photo';
}
