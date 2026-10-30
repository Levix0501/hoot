import { FolderIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'
import {
  byName,
  isLabelColor,
  LABEL_COLORS,
  labelText,
  namedLabels,
  randomLabelColor,
  type Label,
  type LabelGroup,
  type Labels,
  type NamedLabel,
} from '../../../shared/labels'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/app-store'
import { LabelDot } from '../issues/labels'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label as FieldLabel } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/** A row of the list: a label without a group, or a group with its labels. */
type Entry =
  | { kind: 'label'; name: string; label: NamedLabel }
  | { kind: 'group'; name: string; group: LabelGroup; labels: NamedLabel[] }

/**
 * The rows of the list, as Hoot lists labels: the labels without a group and
 * the groups by name, without regard to case, each group's labels under it
 * in the order they were created.
 */
function entries(labels: Labels): Entry[] {
  const named = namedLabels(labels)
  const rows: Entry[] = [
    ...named
      .filter((label) => label.groupId === null)
      .map((label) => ({ kind: 'label' as const, name: label.name, label })),
    ...labels.groups.map((group) => ({
      kind: 'group' as const,
      name: group.name,
      group,
      labels: named.filter((label) => label.groupId === group.id).toSorted((a, b) => a.id - b.id),
    })),
  ]
  return rows.toSorted(byName)
}

/** How many issues Hoot shows have a label. */
function useCarriers(labelId: number): number {
  return useAppStore((state) => {
    const shown = new Set(state.issues.map((issue) => issue.id))
    return state.labels.issueLabels.filter(
      (entry) => entry.labelId === labelId && shown.has(entry.issueId),
    ).length
  })
}

/** A count of issues, as a sentence says it: "1 issue", "2 issues". */
const issueCount = (count: number) => (count === 1 ? '1 issue' : `${count} issues`)

/** The colors a label can be given: Hoot's, and the hexadecimal digits of any other. */
function ColorField({ value, onChange }: { value: string; onChange(color: string): void }) {
  const inputId = useId()
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={inputId}>Color</FieldLabel>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colors">
        {LABEL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === color}
            aria-label={`#${color}`}
            className="flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/60"
            onClick={() => onChange(color)}
            data-testid="label-color-option"
            data-color={color}
          >
            <span className="size-4 rounded-full" style={{ backgroundColor: `#${color}` }} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">#</span>
        <Input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/^#/, ''))}
          maxLength={6}
          className="w-28 font-mono"
          aria-invalid={!isLabelColor(value) || undefined}
          data-testid="label-color"
        />
        {isLabelColor(value) && <LabelDot color={value} className="size-3" />}
      </div>
    </div>
  )
}

/** What the dialog of a label edits: a new label, or one there is. */
type LabelDialogTarget = { kind: 'new' } | { kind: 'edit'; label: Label }

/**
 * The dialog that creates a label or changes one: its name, color,
 * description and group, which no workflow's group can be. What cannot be
 * saved, such as a name another label has, is said and nothing changes.
 */
function LabelDialog({
  target,
  groups,
  onClose,
}: {
  target: LabelDialogTarget
  groups: readonly LabelGroup[]
  onClose(): void
}) {
  const createLabel = useAppStore((state) => state.createLabel)
  const editLabel = useAppStore((state) => state.editLabel)
  const editing = target.kind === 'edit' ? target.label : null
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState(editing?.color ?? randomLabelColor())
  const [description, setDescription] = useState(editing?.description ?? '')
  const [groupId, setGroupId] = useState<number | null>(editing?.groupId ?? null)
  const [busy, setBusy] = useState(false)
  const nameId = useId()
  const descriptionId = useId()
  const groupItems = useMemo(
    () => [
      { value: 'none', label: 'No group' },
      ...groups
        .filter((group) => group.workflow === null)
        .map((group) => ({ value: String(group.id), label: group.name })),
    ],
    [groups],
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const done =
        editing === null
          ? await createLabel({ name, color, description, groupId })
          : await editLabel(editing.id, {
              ...(name !== editing.name ? { name } : {}),
              ...(color !== editing.color ? { color } : {}),
              ...(description !== editing.description ? { description } : {}),
              ...(groupId !== editing.groupId ? { groupId } : {}),
            })
      if (done) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md" data-testid="label-dialog">
      <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>{editing === null ? 'New label' : 'Edit label'}</DialogTitle>
          <DialogDescription>
            Any issue can have any label. An issue has at most one label of a group.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <FieldLabel htmlFor={nameId}>Name</FieldLabel>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            data-testid="label-name"
          />
        </div>
        <ColorField value={color} onChange={setColor} />
        <div className="grid gap-2">
          <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
          <Input
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="None"
            data-testid="label-description"
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel>Group</FieldLabel>
          <Select
            items={groupItems}
            value={groupId === null ? 'none' : String(groupId)}
            onValueChange={(value) => setGroupId(value === 'none' ? null : Number(value))}
          >
            <SelectTrigger className="w-full" data-testid="label-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groupItems.map((item) => (
                <SelectItem
                  key={item.value}
                  value={item.value}
                  data-testid="label-group-option"
                  data-group={item.label}
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} data-testid="label-dialog-save">
            {editing === null ? 'Create label' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** The dialog that creates a group of labels. */
function GroupDialog({ onClose }: { onClose(): void }) {
  const createLabelGroup = useAppStore((state) => state.createLabelGroup)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const nameId = useId()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (await createLabelGroup(name)) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogContent className="sm:max-w-md" data-testid="label-group-dialog">
      <form className="grid gap-5" onSubmit={(event) => void submit(event)}>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>An issue has at most one label of a group.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <FieldLabel htmlFor={nameId}>Name</FieldLabel>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            data-testid="label-group-name"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} data-testid="label-group-dialog-save">
            Create group
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

/** What a confirmation asks to delete. */
type Deletion = { kind: 'label'; label: NamedLabel } | { kind: 'group'; group: LabelGroup }

/**
 * Asks before a label or a group is deleted. Deleting a label takes it off
 * every issue that has it, which it says, with how many issues Hoot shows
 * have it; deleting a group leaves its labels without one.
 */
function DeleteDialog({ deletion, onClose }: { deletion: Deletion; onClose(): void }) {
  const deleteLabel = useAppStore((state) => state.deleteLabel)
  const deleteLabelGroup = useAppStore((state) => state.deleteLabelGroup)
  const carriers = useCarriers(deletion.kind === 'label' ? deletion.label.id : -1)
  const name =
    deletion.kind === 'label'
      ? labelText(deletion.label.name, deletion.label.group)
      : deletion.group.name
  return (
    <AlertDialogContent data-testid="label-delete-dialog" data-kind={deletion.kind}>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {deletion.kind === 'label' ? 'Delete this label?' : 'Delete this group?'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          <span className="font-medium break-words text-foreground" data-user-text="">
            {name}
          </span>{' '}
          will be deleted for good.{' '}
          {deletion.kind === 'label' ? (
            carriers > 0 ? (
              <span data-testid="label-delete-carriers" data-count={carriers}>
                {issueCount(carriers)} {carriers === 1 ? 'has' : 'have'} it, and will no longer have
                it once it is deleted.
              </span>
            ) : (
              'No issue has it.'
            )
          ) : (
            'Its labels will stay, without a group, and the issues that have them will keep them.'
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="label-delete-cancel">Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => {
            onClose()
            void (deletion.kind === 'label'
              ? deleteLabel(deletion.label.id)
              : deleteLabelGroup(deletion.group.id))
          }}
          data-testid="label-delete-confirm"
        >
          {deletion.kind === 'label' ? 'Delete Label' : 'Delete Group'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

/** A label's row: its color, name and description, with how many issues have it, and its buttons. */
function LabelRow({
  label,
  locked,
  inGroup,
  onEdit,
  onDelete,
}: {
  label: NamedLabel
  locked: boolean
  inGroup: boolean
  onEdit(): void
  onDelete(): void
}) {
  const carriers = useCarriers(label.id)
  return (
    <li
      className={cn(
        'group/label-row flex min-h-10 items-center gap-3 rounded-md px-3 py-1.5 hover:bg-muted/50',
        inGroup && 'pl-9',
      )}
      data-testid="labels-page-label"
      data-label-id={label.id}
      data-label={labelText(label.name, label.group)}
      data-locked={locked || undefined}
    >
      <LabelDot color={label.color} className="size-2.5" />
      <span
        className="min-w-0 shrink-0 truncate text-sm font-medium"
        data-testid="labels-page-name"
      >
        {label.name}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
        data-testid="labels-page-description"
      >
        {label.description}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {issueCount(carriers)}
      </span>
      {/* As wide whether or not it has buttons, so that the counts line up. */}
      <span className="flex w-12.5 shrink-0 justify-end gap-0.5 opacity-0 group-hover/label-row:opacity-100 focus-within:opacity-100">
        {!locked && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${label.name}`}
              onClick={onEdit}
              data-testid="labels-page-edit"
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${label.name}`}
              onClick={onDelete}
              data-testid="labels-page-delete"
            >
              <Trash2Icon />
            </Button>
          </>
        )}
      </span>
    </li>
  )
}

/**
 * The settings' Labels page, as Linear's: every group and label, with New
 * group and New label. A label can be created, given another name, color,
 * description or group, or deleted, and a group created or deleted. The
 * group of a workflow and its labels are listed too, without any of these.
 */
export function LabelsPage() {
  const labels = useAppStore((state) => state.labels)
  const rows = useMemo(() => entries(labels), [labels])
  const [dialog, setDialog] = useState<
    { kind: 'label'; target: LabelDialogTarget } | { kind: 'group' } | null
  >(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)
  const closeDialog = () => setDialog(null)

  const labelRow = (label: NamedLabel, locked: boolean) => (
    <LabelRow
      key={label.id}
      label={label}
      locked={locked}
      inGroup={label.groupId !== null}
      onEdit={() => setDialog({ kind: 'label', target: { kind: 'edit', label } })}
      onDelete={() => setDeletion({ kind: 'label', label })}
    />
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="labels-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11.5 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-2xl font-semibold tracking-tight">Labels</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialog({ kind: 'group' })}
              data-testid="labels-page-new-group"
            >
              <FolderIcon />
              New group
            </Button>
            <Button
              size="sm"
              onClick={() => setDialog({ kind: 'label', target: { kind: 'new' } })}
              data-testid="labels-page-new-label"
            >
              <PlusIcon />
              New label
            </Button>
          </div>
          <ul className="grid gap-0.5" data-testid="labels-page-list">
            {rows.map((row) =>
              row.kind === 'label' ? (
                labelRow(row.label, false)
              ) : (
                <li key={`group-${row.group.id}`} className="grid gap-0.5">
                  <div
                    className="group/group-row flex min-h-10 items-center gap-3 rounded-md px-3 py-1.5 hover:bg-muted/50"
                    data-testid="labels-page-group"
                    data-group-id={row.group.id}
                    data-group={row.group.name}
                    data-workflow={row.group.workflow ?? undefined}
                  >
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate text-sm font-medium">{row.group.name}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {row.group.workflow === null ? (
                        `${row.labels.length} ${row.labels.length === 1 ? 'label' : 'labels'}`
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <LockIcon className="size-3" />
                          The workflow {row.group.workflow} keeps this group and its labels as they
                          are
                        </span>
                      )}
                    </span>
                    {row.group.workflow === null && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover/group-row:opacity-100 focus-visible:opacity-100"
                        aria-label={`Delete group ${row.group.name}`}
                        onClick={() => setDeletion({ kind: 'group', group: row.group })}
                        data-testid="labels-page-delete-group"
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                  {row.labels.length > 0 && (
                    <ul className="grid gap-0.5">
                      {row.labels.map((label) => labelRow(label, row.group.workflow !== null))}
                    </ul>
                  )}
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        {dialog?.kind === 'label' && (
          <LabelDialog
            key={dialog.target.kind === 'edit' ? dialog.target.label.id : 'new'}
            target={dialog.target}
            groups={labels.groups}
            onClose={closeDialog}
          />
        )}
        {dialog?.kind === 'group' && <GroupDialog onClose={closeDialog} />}
      </Dialog>
      <AlertDialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open) setDeletion(null)
        }}
      >
        {deletion !== null && (
          <DeleteDialog deletion={deletion} onClose={() => setDeletion(null)} />
        )}
      </AlertDialog>
    </div>
  )
}
