import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import { MAX_BLOCKED_BY, MAX_BLOCKING } from '../shared/dependencies'
import {
  HOOK_EVENTS,
  HOOT_ENV,
  MAX_PROMPT_LENGTH,
  type BatchIssue,
  type BatchReference,
  type HookEventReport,
  type HootAnswer,
  type IssueEdit,
} from '../shared/hoot-cli'
import {
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  isIssueOpen,
  issueIdentifier,
  issueTitle,
  listOrder,
} from '../shared/issues'
import { sameName } from '../shared/labels'
import { MAX_SUB_ISSUE_LEVEL, MAX_SUB_ISSUES } from '../shared/sub-issues'
import { CliError, HootClient } from './client'
import { issueJson, issueListText, issueText, jsonText, labelJson, labelListText } from './format'
import { PRIORITY_NAME_LIST, STATUS_NAME_LIST, priorityNamed, statusNamed } from './names'

/** What hoot works with: its environment, its output, and the files it reads. */
export interface CliIo {
  env: Readonly<Record<string, string | undefined>>
  /** Writes to standard output. */
  write(text: string): void
  /** Writes to standard error. */
  writeError(text: string): void
  /** All of standard input. */
  readStdin(): Promise<Uint8Array>
  readFile(path: string): Promise<Uint8Array>
  /** When hoot started, in milliseconds since the Unix epoch. */
  startedAt: number
}

/**
 * The number of an issue as given on the command line, in decimal digits as
 * given, from an identifier, such as "ISS-12", or a number, such as "12";
 * `null` for anything else.
 */
export function issueNumberDigits(text: string): string | null {
  return /^(?:ISS-)?(\d+)$/.exec(text)?.[1] ?? null
}

/** The number of an issue given on the command line, or a `CliError` when it is not one. */
function givenIssue(text: string): string {
  const digits = issueNumberDigits(text)
  if (digits === null) {
    throw new CliError(
      `"${text}" is neither an issue's identifier, such as ISS-12, nor its number, such as 12.`,
    )
  }
  return digits
}

/** The numbers of the issues given on the command line, separated by commas. */
function givenIssues(list: string): string[] {
  return list.split(',').map((text) => givenIssue(text.trim()))
}

/**
 * Adds the names an option of names is given, which may be given again and
 * hold several names separated by commas, to those it was given before.
 */
function addNames(value: string, previous: string[] | undefined): string[] {
  const names = value.split(',').map((name) => name.trim())
  if (names.some((name) => name === '')) {
    throw new InvalidArgumentError('A label name is empty.')
  }
  return [...(previous ?? []), ...names]
}

const quantity = new Intl.NumberFormat('en-US')

/** Why a title cannot be saved, said of `what`, such as "The title"; `null` when it can. */
function titleProblem(title: string, what: string): string | null {
  if (title.length > ISSUE_TITLE_MAX_LENGTH) {
    return (
      `${what} is ${quantity.format(title.length)} characters long; ` +
      `Hoot saves titles of up to ${quantity.format(ISSUE_TITLE_MAX_LENGTH)}.`
    )
  }
  if (issueTitle(title) === '') return `${what} is empty: an issue needs one.`
  return null
}

/** Why a description cannot be saved, said of `what`, such as "The description"; `null` when it can. */
function descriptionProblem(description: string, what: string): string | null {
  if (description.length <= ISSUE_DESCRIPTION_MAX_LENGTH) return null
  return (
    `${what} is ${quantity.format(description.length)} characters long; ` +
    `Hoot saves descriptions of up to ${quantity.format(ISSUE_DESCRIPTION_MAX_LENGTH)}.`
  )
}

/** The fields an issue of `hoot issue create-batch` may have. */
const BATCH_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'labels',
  'blockedBy',
  'blocking',
]

/** A JSON value as a message quotes it. */
const quoted = (value: unknown) => JSON.stringify(value)

/**
 * The sub-issues `hoot issue create-batch` is to create, from the JSON of
 * `source`: an array with an object for each, or a `CliError` saying what is
 * wrong.
 */
export function batchIssues(text: string, source: string): BatchIssue[] {
  let value: unknown
  try {
    // A byte order mark is not part of the JSON.
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new CliError(
      `The issues in ${source} are not JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!Array.isArray(value)) {
    throw new CliError(
      `The issues in ${source} are not a JSON array, with an object for each issue.`,
    )
  }
  const count = value.length
  return value.map((entry: unknown, index): BatchIssue => {
    const item = `item ${index + 1}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new CliError(`Item ${index + 1} in ${source} is not a JSON object.`)
    }
    const fields = entry as Record<string, unknown>
    for (const key of Object.keys(fields)) {
      if (!BATCH_FIELDS.includes(key)) {
        throw new CliError(
          `Item ${index + 1} in ${source} has the field ${quoted(key)}, which an issue does not ` +
            `have: it has "title", and may have "description", "status", "priority", ` +
            `"labels", "blockedBy" and "blocking".`,
        )
      }
    }
    const { title, description = '', status, priority } = fields
    if (title === undefined) throw new CliError(`Item ${index + 1} in ${source} has no "title".`)
    if (typeof title !== 'string') {
      throw new CliError(`The title of ${item} in ${source} is not a string.`)
    }
    const titleIssue = titleProblem(title, `The title of ${item}`)
    if (titleIssue !== null) throw new CliError(titleIssue)
    if (typeof description !== 'string') {
      throw new CliError(`The description of ${item} in ${source} is not a string.`)
    }
    const descriptionIssue = descriptionProblem(description, `The description of ${item}`)
    if (descriptionIssue !== null) throw new CliError(descriptionIssue)
    // Only a missing status is Backlog: null is not a status's name.
    const statusName = status === undefined ? 'backlog' : status
    if (typeof statusName !== 'string' || statusNamed(statusName) === undefined) {
      throw new CliError(
        `The status of ${item} in ${source} is ${quoted(statusName)}, which is not one of ` +
          `${STATUS_NAME_LIST.join(', ')}.`,
      )
    }
    if (
      priority !== undefined &&
      (typeof priority !== 'string' || priorityNamed(priority) === undefined)
    ) {
      throw new CliError(
        `The priority of ${item} in ${source} is ${quoted(priority)}, which is not one of ` +
          `${PRIORITY_NAME_LIST.join(', ')}.`,
      )
    }
    /** The issues a field lists, each another item by its place, or an issue by its identifier. */
    const references = (field: 'blockedBy' | 'blocking'): BatchReference[] => {
      // Only a missing field lists none: null is not an array.
      const list = fields[field] === undefined ? [] : fields[field]
      if (!Array.isArray(list)) {
        throw new CliError(`The ${quoted(field)} of ${item} in ${source} is not a JSON array.`)
      }
      return list.map((given: unknown) => {
        if (typeof given === 'number' && Number.isInteger(given) && given >= 1 && given <= count) {
          return { item: given }
        }
        const digits = typeof given === 'string' ? /^ISS-(\d+)$/.exec(given)?.[1] : undefined
        if (digits !== undefined) return { issue: digits }
        throw new CliError(
          `The ${quoted(field)} of ${item} in ${source} has ${quoted(given)}, which is neither ` +
            `the place of an item, from 1 to ${count}, nor the identifier of an issue, such as ` +
            '"ISS-12".',
        )
      })
    }
    // Only a missing field lists none: null is not an array.
    const labels = fields.labels === undefined ? [] : fields.labels
    if (!Array.isArray(labels)) {
      throw new CliError(`The "labels" of ${item} in ${source} is not a JSON array.`)
    }
    for (const label of labels as unknown[]) {
      if (typeof label !== 'string' || label.trim() === '') {
        throw new CliError(
          `The "labels" of ${item} in ${source} has ${quoted(label)}, which is not a label's name.`,
        )
      }
    }
    return {
      title,
      description,
      status: statusNamed(statusName)!,
      ...(priority === undefined ? {} : { priority: priorityNamed(priority as string)! }),
      blockedBy: references('blockedBy'),
      blocking: references('blocking'),
      labels: (labels as string[]).map((label) => label.trim()),
    }
  })
}

/** What Hoot answered, or a `CliError` with why it could not do what was asked. */
function answered<T extends HootAnswer<object>>(answer: T): Extract<T, { ok: true }> {
  if (!answer.ok) throw new CliError(answer.message)
  return answer as Extract<T, { ok: true }>
}

/**
 * Checks that each of the names is a label's, whatever its case; a
 * `CliError` names the first that is not.
 */
async function knownLabels(client: HootClient, names: readonly string[]): Promise<void> {
  const { labels } = answered(await client.listLabels())
  for (const name of names) {
    if (!labels.some((label) => sameName(label.name, name))) {
      throw new CliError(
        `There is no label named "${name}". Run "hoot label list" for the labels there are.`,
      )
    }
  }
}

/** Text decoded as UTF-8, kept exactly as it is, byte order mark included. */
function utf8Text(bytes: Uint8Array, what: string, source: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new CliError(`The ${what} in ${source} is not UTF-8 text.`)
  }
}

/**
 * The event of a Claude Code hook whose input is `input`, the JSON Claude
 * Code gives a hook on standard input, when it is one Hoot takes, and whether
 * a subagent met it (the input names the agent); `null` for any other input.
 */
export function hookEventOf(input: Uint8Array): Omit<HookEventReport, 'startedAt'> | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(input))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { hook_event_name: name, agent_id: agent } = value as {
    hook_event_name?: unknown
    agent_id?: unknown
  }
  const event = HOOK_EVENTS.find((candidate) => candidate === name)
  if (event === undefined) return null
  return { event, subagent: typeof agent === 'string' && agent !== '' }
}

/**
 * Builds hoot's commands: `hoot issue view`, `list`, `create`, `edit` and
 * `create-batch`, modeled on `gh issue`, which read or create the issues of
 * the project of the Hoot session hoot runs in, and change their parents,
 * sub-issues, dependencies and labels; `hoot label list`, `create`, `edit`
 * and `delete`, modeled on `gh label`; and `hoot session start`, which starts
 * a session for an issue. Each works through the Hoot that started the
 * session.
 */
export function hootProgram(io: CliIo): Command {
  /** The Hoot and the session that the session's environment names. */
  const connect = (): HootClient => {
    const socket = io.env[HOOT_ENV.socket]
    const sessionId = io.env[HOOT_ENV.sessionId]
    if (!socket || !sessionId) {
      throw new CliError(
        `hoot works only in the sessions that Hoot starts, whose environment tells it which ` +
          `Hoot and session it works for: ${HOOT_ENV.socket} and ${HOOT_ENV.sessionId} are not set.`,
      )
    }
    return new HootClient(socket, sessionId)
  }

  /** The text of a UTF-8 file, or of standard input for `-`, which is the `what` of a command. */
  const readText = async (file: string, what: string): Promise<string> => {
    const source = file === '-' ? 'standard input' : file
    let bytes: Uint8Array
    try {
      bytes = file === '-' ? await io.readStdin() : await io.readFile(file)
    } catch (error) {
      throw new CliError(
        `Could not read the ${what} from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return utf8Text(bytes, what, source)
  }

  const program = new Command('hoot')
    .description(
      'Read and create the issues of the project of the Hoot session that hoot runs in, change ' +
        'their parents, sub-issues, dependencies and labels, create sub-issues of an issue all ' +
        'at once, manage the labels, and start sessions for the issues.',
    )
    .configureOutput({
      writeOut: (text) => io.write(text),
      writeErr: (text) => io.writeError(text),
    })
    .exitOverride()
    .addHelpText(
      'after',
      '\nRun "hoot issue --help" for the issue commands, their options, and the names of the statuses and priorities.' +
        '\nRun "hoot label --help" for the label commands.' +
        '\nRun "hoot session --help" for starting a session for an issue.',
    )

  const issueCommand: Command = program
    .command('issue')
    .description(
      "Show, list and create the issues of the session's project, change their parents, " +
        'sub-issues, dependencies and labels, and create sub-issues of an issue all at once',
    )
    // Every command's usage, so that this help says all there is.
    .addHelpText('after', () =>
      issueCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  issueCommand
    .command('view')
    .description(
      'Show an issue: its identifier and title; its status, priority and creation time; its ' +
        'labels; the issue it is a sub-issue of; its description; its sub-issues; and the issues ' +
        'it is blocked by and those it blocks',
    )
    .argument('<issue>', "the issue's identifier, such as ISS-12, or its number, such as 12")
    .option('--json', 'print the issue as a JSON object')
    .action(async (text: string, options: { json?: boolean }) => {
      const digits = givenIssue(text)
      // Hoot answers only with an issue of the session's project.
      const { project, issue: found } = answered(await connect().issue(digits))
      if (found === null) {
        throw new CliError(
          `There is no issue ISS-${digits} in this session's project, ${project.name}.`,
        )
      }
      io.write(options.json ? jsonText(issueJson(found)) : issueText(found, project))
    })

  issueCommand
    .command('list')
    .description(
      "List the project's issues that are neither done nor canceled, in the order of the Issues page",
    )
    .option('--all', 'list every issue, done and canceled ones too')
    .addOption(
      new Option(
        '--status <name>',
        'list only the issues with this status, done or not; give it again for more statuses (with it, --all does nothing)',
      )
        .choices(STATUS_NAME_LIST)
        .argParser((name: string, previous: string[] | undefined) => {
          if (!STATUS_NAME_LIST.includes(name)) {
            throw new InvalidArgumentError(`Allowed choices are ${STATUS_NAME_LIST.join(', ')}.`)
          }
          return [...(previous ?? []), name]
        }),
    )
    .option(
      '--label <names>',
      'list only the issues that have every one of these labels, separated by commas; give it again for more',
      addNames,
    )
    .option('--json', 'print the issues as a JSON array of objects')
    .action(
      async (options: { all?: boolean; status?: string[]; label?: string[]; json?: boolean }) => {
        const client = connect()
        if (options.label !== undefined) await knownLabels(client, options.label)
        const { issues } = answered(await client.listIssues())
        const statuses = options.status?.map((name) => statusNamed(name))
        const listed = listOrder(issues, 'all').filter(
          (issue) =>
            (statuses === undefined
              ? options.all === true || isIssueOpen(issue)
              : statuses.includes(issue.status)) &&
            (options.label ?? []).every((name) =>
              issue.labels.some((label) => sameName(label.name, name)),
            ),
        )
        io.write(options.json ? jsonText(listed.map(issueJson)) : issueListText(listed))
      },
    )

  issueCommand
    .command('create')
    .description("Create an issue in the session's project, and print its identifier")
    .requiredOption(
      '--title <title>',
      'the title, saved on one line, each line break a space, and without the whitespace around it',
    )
    .addOption(
      new Option('--description <text>', 'the description, in Markdown').conflicts(
        'descriptionFile',
      ),
    )
    .option(
      '--description-file <file>',
      'read the description from a UTF-8 file, or from standard input with -',
    )
    .addOption(
      new Option('--status <name>', 'the status').choices(STATUS_NAME_LIST).default('backlog'),
    )
    .addOption(
      new Option('--priority <name>', 'the priority')
        .choices(PRIORITY_NAME_LIST)
        .default('none', '"none", or with --parent the parent\'s'),
    )
    .option(
      '--parent <issue>',
      'create it as a sub-issue of this issue of the project, after its other sub-issues: the ' +
        "parent's identifier, such as ISS-12, or its number",
    )
    .option(
      '--blocked-by <issues>',
      'make it blocked by these issues of the project, separated by commas, which it waits for',
    )
    .option(
      '--blocking <issues>',
      'make these issues of the project, separated by commas, blocked by it, so that they wait for it',
    )
    .option(
      '--label <names>',
      'give it these labels, separated by commas; give it again for more',
      addNames,
    )
    .option('--json', 'print the new issue as a JSON object instead of its identifier')
    .action(
      async (
        options: {
          title: string
          description?: string
          descriptionFile?: string
          status: string
          priority: string
          parent?: string
          blockedBy?: string
          blocking?: string
          label?: string[]
          json?: boolean
        },
        command: Command,
      ) => {
        const { title } = options
        const parent = options.parent === undefined ? undefined : givenIssue(options.parent)
        const blockedBy =
          options.blockedBy === undefined ? undefined : givenIssues(options.blockedBy)
        const blocking = options.blocking === undefined ? undefined : givenIssues(options.blocking)
        const titleIssue = titleProblem(title, 'The title')
        if (titleIssue !== null) throw new CliError(titleIssue)
        const description =
          options.descriptionFile === undefined
            ? (options.description ?? '')
            : await readText(options.descriptionFile, 'description')
        const descriptionIssue = descriptionProblem(description, 'The description')
        if (descriptionIssue !== null) throw new CliError(descriptionIssue)
        // A sub-issue takes its parent's priority unless one is given.
        const priorityGiven =
          parent === undefined || command.getOptionValueSource('priority') !== 'default'
        const { issue: created } = answered(
          await connect().createIssue({
            title,
            description,
            status: statusNamed(options.status)!,
            ...(priorityGiven ? { priority: priorityNamed(options.priority)! } : {}),
            ...(parent === undefined ? {} : { parent }),
            ...(blockedBy === undefined ? {} : { blockedBy }),
            ...(blocking === undefined ? {} : { blocking }),
            ...(options.label === undefined ? {} : { labels: options.label }),
          }),
        )
        io.write(options.json ? jsonText(issueJson(created)) : `${issueIdentifier(created.id)}\n`)
      },
    )

  issueCommand
    .command('edit')
    .description(
      'Change the parent, the sub-issues, the dependencies and the labels of an issue, all ' +
        'together or, when one of the changes cannot be made, not at all, and print its ' +
        `identifier. An issue has at most ${MAX_SUB_ISSUES} sub-issues and is at most ` +
        `${MAX_SUB_ISSUE_LEVEL} levels below a top-level issue, and cannot be below itself. An ` +
        `issue waits for the issues it is blocked by; it is blocked by at most ${MAX_BLOCKED_BY} ` +
        `issues and blocks at most ${MAX_BLOCKING}, and cannot wait for itself, but can be ` +
        'blocked by an issue above or below it, or block one. An issue has at most one label ' +
        'of a group: given another, it no longer has the one it had',
    )
    .argument('<issue>', "the issue's identifier, such as ISS-12, or its number, such as 12")
    .addOption(
      new Option(
        '--parent <issue>',
        'make it a sub-issue of this issue of the project, after its other sub-issues, ' +
          'instead of a sub-issue of the parent it has',
      ).conflicts('removeParent'),
    )
    .option('--remove-parent', 'make it a top-level issue, without a parent')
    .option(
      '--add-sub-issue <issues>',
      'make these issues of the project, separated by commas, its last sub-issues, in this ' +
        'order, instead of sub-issues of the parents they have',
    )
    .option(
      '--remove-sub-issue <issues>',
      'make these sub-issues of it, separated by commas, top-level issues',
    )
    .option(
      '--add-blocked-by <issues>',
      'make it blocked by these issues of the project, separated by commas, which it waits for',
    )
    .option(
      '--remove-blocked-by <issues>',
      'make it no longer blocked by these issues, separated by commas',
    )
    .option(
      '--add-blocking <issues>',
      'make these issues of the project, separated by commas, blocked by it, so that they wait for it',
    )
    .option(
      '--remove-blocking <issues>',
      'make these issues, separated by commas, no longer blocked by it',
    )
    .option(
      '--add-label <names>',
      'give it these labels, separated by commas, in this order; give it again for more',
      addNames,
    )
    .option(
      '--remove-label <names>',
      'take these labels, separated by commas, off it; give it again for more',
      addNames,
    )
    .action(
      async (
        text: string,
        options: {
          parent?: string
          removeParent?: boolean
          addSubIssue?: string
          removeSubIssue?: string
          addBlockedBy?: string
          removeBlockedBy?: string
          addBlocking?: string
          removeBlocking?: string
          addLabel?: string[]
          removeLabel?: string[]
        },
      ) => {
        const digits = givenIssue(text)
        const edit: IssueEdit = {}
        if (options.parent !== undefined) edit.parent = givenIssue(options.parent)
        if (options.removeParent) edit.removeParent = true
        if (options.addSubIssue !== undefined) edit.addSubIssues = givenIssues(options.addSubIssue)
        if (options.removeSubIssue !== undefined) {
          edit.removeSubIssues = givenIssues(options.removeSubIssue)
        }
        if (options.addBlockedBy !== undefined) {
          edit.addBlockedBy = givenIssues(options.addBlockedBy)
        }
        if (options.removeBlockedBy !== undefined) {
          edit.removeBlockedBy = givenIssues(options.removeBlockedBy)
        }
        if (options.addBlocking !== undefined) edit.addBlocking = givenIssues(options.addBlocking)
        if (options.removeBlocking !== undefined) {
          edit.removeBlocking = givenIssues(options.removeBlocking)
        }
        if (options.addLabel !== undefined) edit.addLabels = options.addLabel
        if (options.removeLabel !== undefined) edit.removeLabels = options.removeLabel
        if (Object.keys(edit).length === 0) {
          throw new CliError(
            'Nothing to change: give --parent, --remove-parent, --add-sub-issue, ' +
              '--remove-sub-issue, --add-blocked-by, --remove-blocked-by, --add-blocking, ' +
              '--remove-blocking, --add-label or --remove-label.',
          )
        }
        const { issue: edited } = answered(await connect().editIssue(digits, edit))
        io.write(`${issueIdentifier(edited.id)}\n`)
      },
    )

  issueCommand
    .command('create-batch')
    .description(
      'Create the issues a JSON file lists as the last sub-issues of an issue, in order, each ' +
        'blocked by the issues it lists, blocking others and with the labels it lists, all ' +
        'together or, when one of them cannot be created, none; and print their identifiers, ' +
        'in order. Each is created as "hoot issue create --parent <issue>" creates one, with ' +
        'the same rules',
    )
    .argument('<issue>', "the issue's identifier, such as ISS-12, or its number, such as 12")
    .requiredOption(
      '--file <file>',
      'read the issues from a UTF-8 file, or from standard input with -: a JSON array with an ' +
        'object for each issue, with "title", and optionally "description", "status" and ' +
        '"priority" (by their names), "labels", an array of the names of its labels, ' +
        '"blockedBy", the issues it is blocked by, and "blocking", those it blocks: arrays of ' +
        'the places of other issues in the array, from 1, and the identifiers of issues of the ' +
        'project, such as "ISS-12"',
    )
    .option(
      '--json',
      'print the new issues as a JSON array of objects instead of their identifiers',
    )
    .action(async (text: string, options: { file: string; json?: boolean }) => {
      const digits = givenIssue(text)
      const source = options.file === '-' ? 'standard input' : options.file
      const issues = batchIssues(await readText(options.file, 'issues'), source)
      const { issues: created } = answered(await connect().createBatch(digits, issues))
      io.write(
        options.json
          ? jsonText(created.map(issueJson))
          : created.map((issue) => `${issueIdentifier(issue.id)}\n`).join(''),
      )
    })

  const labelCommand: Command = program
    .command('label')
    .description('List, create, change and delete the labels, which any issue can have')
    .addHelpText('after', () =>
      labelCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  labelCommand
    .command('list')
    .description(
      'List the labels, one line each: the name, the group (No group for none), the color and ' +
        'the description',
    )
    .option('--json', 'print the labels as a JSON array of objects')
    .action(async (options: { json?: boolean }) => {
      const { labels } = answered(await connect().listLabels())
      io.write(options.json ? jsonText(labels.map(labelJson)) : labelListText(labels))
    })

  labelCommand
    .command('create')
    .description(
      'Create a label, without a group. No two labels can have the same name, whatever its case',
    )
    .argument('<name>', "the label's name")
    .option('--color <color>', 'six hexadecimal digits, such as ff8800; without it, Hoot picks one')
    .option('--description <text>', 'a description; without it, the label has none')
    .action(async (name: string, options: { color?: string; description?: string }) => {
      answered(
        await connect().createLabel({
          name,
          ...(options.color === undefined ? {} : { color: options.color }),
          ...(options.description === undefined ? {} : { description: options.description }),
        }),
      )
    })

  labelCommand
    .command('edit')
    .description(
      "Change a label's name, color or description. Some labels, which Hoot keeps as they " +
        'are, cannot be changed: hoot then says why',
    )
    .argument('<name>', "the label's name, whatever its case")
    .option('--name <name>', 'its new name')
    .option('--color <color>', 'its new color: six hexadecimal digits, such as ff8800')
    .option('--description <text>', 'its new description')
    .action(
      async (name: string, options: { name?: string; color?: string; description?: string }) => {
        if (
          options.name === undefined &&
          options.color === undefined &&
          options.description === undefined
        ) {
          throw new CliError('Nothing to change: give --name, --color or --description.')
        }
        answered(
          await connect().editLabel(name, {
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.color === undefined ? {} : { color: options.color }),
            ...(options.description === undefined ? {} : { description: options.description }),
          }),
        )
      },
    )

  labelCommand
    .command('delete')
    .description(
      'Delete a label, which every issue that has it no longer has. Some labels, which Hoot ' +
        'keeps as they are, cannot be deleted: hoot then says why',
    )
    .argument('<name>', "the label's name, whatever its case")
    .option('--yes', 'delete it: without it, hoot deletes nothing')
    .action(async (name: string, options: { yes?: boolean }) => {
      if (options.yes !== true) {
        throw new CliError(
          'Deleting a label takes it off every issue that has it, and cannot be undone: ' +
            'give --yes to delete it.',
        )
      }
      answered(await connect().deleteLabel(name))
    })

  const sessionCommand: Command = program
    .command('session')
    .description('Start sessions for the issues')
    .addHelpText('after', () =>
      sessionCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  sessionCommand
    .command('start')
    .description(
      "Start a Claude Code session for an issue of the project, in the issue's worktree, as its " +
        'start button in Hoot starts one, and print the root of the worktree. It shows in the ' +
        "sidebar, and Hoot's window goes on showing what it showed. Nothing starts while the " +
        "issue's start button could not start a session either, such as while the issue waits " +
        'on issues neither done nor canceled: hoot then says why',
    )
    .argument('<issue>', "the issue's identifier, such as ISS-12, or its number, such as 12")
    .option(
      '--prompt-file <file>',
      "the session's first message, from a UTF-8 file, or from standard input with -; without " +
        'it, Hoot gives the session the first message its start button would',
    )
    .action(async (text: string, options: { promptFile?: string }) => {
      const digits = givenIssue(text)
      const prompt =
        options.promptFile === undefined
          ? null
          : await readText(options.promptFile, 'first message')
      if (prompt !== null && prompt.length > MAX_PROMPT_LENGTH) {
        throw new CliError(
          `The first message is ${quantity.format(prompt.length)} characters long; a session ` +
            `is given one of up to ${quantity.format(MAX_PROMPT_LENGTH)}.`,
        )
      }
      const { worktreePath } = answered(await connect().startSession(digits, prompt))
      io.write(`${worktreePath}\n`)
    })

  // Not for people: the command of the hooks Hoot adds to its Claude Code sessions.
  program
    .command('hook', { hidden: true })
    .description(
      "Report the event of a Claude Code hook, from the hook's input on standard input, to Hoot, " +
        'which shows what the session is doing. It prints nothing and always succeeds, so that ' +
        'it never changes what Claude Code does.',
    )
    .action(async () => {
      try {
        const hook = hookEventOf(await io.readStdin())
        if (hook !== null) await connect().reportHookEvent({ ...hook, startedAt: io.startedAt })
      } catch {
        // Hoot shows less of what the session is doing; Claude Code goes on as it would.
      }
    })

  return program
}

/** Runs hoot with its arguments, and returns its exit code: 0 when it did what was asked, 1 when not. */
export async function runHoot(args: readonly string[], io: CliIo): Promise<number> {
  try {
    await hootProgram(io).parseAsync(args, { from: 'user' })
    return 0
  } catch (error) {
    // Commander has said what was wrong, or shown the help asked for.
    if (error instanceof CommanderError) return error.exitCode
    io.writeError(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
