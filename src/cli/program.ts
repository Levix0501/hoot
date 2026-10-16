import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import { MAX_BLOCKED_BY, MAX_BLOCKING } from '../shared/dependencies'
import {
  HOOT_ENV,
  type HootAnswer,
  type IssueEdit,
  type SplitIssue,
  type SplitReference,
} from '../shared/hoot-cli'
import {
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  isIssueOpen,
  issueIdentifier,
  issueTitle,
  listOrder,
} from '../shared/issues'
import { MAX_SUB_ISSUE_LEVEL, MAX_SUB_ISSUES } from '../shared/sub-issues'
import { stepReportText } from '../shared/workflow-text'
import { STEP_SUMMARY_MAX_LENGTH } from '../shared/workflows'
import { CliError, HootClient } from './client'
import { issueJson, issueListText, issueText, jsonText } from './format'
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

/** The fields an issue of `hoot issue split` may have. */
const SPLIT_FIELDS = ['title', 'description', 'status', 'priority', 'blockedBy', 'blocking']

/** A JSON value as a message quotes it. */
const quoted = (value: unknown) => JSON.stringify(value)

/**
 * The sub-issues `hoot issue split` is to create, from the JSON of `source`:
 * an array with an object for each, or a `CliError` saying what is wrong.
 */
export function splitIssues(text: string, source: string): SplitIssue[] {
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
  return value.map((entry: unknown, index): SplitIssue => {
    const item = `item ${index + 1}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new CliError(`Item ${index + 1} in ${source} is not a JSON object.`)
    }
    const fields = entry as Record<string, unknown>
    for (const key of Object.keys(fields)) {
      if (!SPLIT_FIELDS.includes(key)) {
        throw new CliError(
          `Item ${index + 1} in ${source} has the field ${quoted(key)}, which an issue does not ` +
            `have: it has "title", and may have "description", "status", "priority", ` +
            `"blockedBy" and "blocking".`,
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
    const references = (field: 'blockedBy' | 'blocking'): SplitReference[] => {
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
    return {
      title,
      description,
      status: statusNamed(statusName)!,
      ...(priority === undefined ? {} : { priority: priorityNamed(priority as string)! }),
      blockedBy: references('blockedBy'),
      blocking: references('blocking'),
    }
  })
}

/** What Hoot answered, or a `CliError` with why it could not do what was asked. */
function answered<T extends HootAnswer<object>>(answer: T): Extract<T, { ok: true }> {
  if (!answer.ok) throw new CliError(answer.message)
  return answer as Extract<T, { ok: true }>
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
 * Builds hoot's commands: `hoot issue view`, `list`, `create`, `edit` and
 * `split`, modeled on `gh issue`, which read or create the issues of the
 * project of the Hoot session hoot runs in, and change their parents,
 * sub-issues and dependencies; and `hoot step report`, which reports a step
 * of the workflow of the issue the session was started from. Each works
 * through the Hoot that started the session.
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
        'their parents, sub-issues and dependencies, split an issue into sub-issues, and report ' +
        'the steps of the workflow of the issue the session was started from.',
    )
    .configureOutput({
      writeOut: (text) => io.write(text),
      writeErr: (text) => io.writeError(text),
    })
    .exitOverride()
    .addHelpText(
      'after',
      '\nRun "hoot issue --help" for the issue commands, their options, and the names of the statuses and priorities.' +
        '\nRun "hoot step --help" for reporting a step of the workflow.',
    )

  const issueCommand: Command = program
    .command('issue')
    .description(
      "Show, list and create the issues of the session's project, change their parents, " +
        'sub-issues and dependencies, and split an issue into sub-issues',
    )
    // Every command's usage, so that this help says all there is.
    .addHelpText('after', () =>
      issueCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  issueCommand
    .command('view')
    .description(
      'Show an issue: its identifier and title; its status, priority and creation time; the issue ' +
        'it is a sub-issue of; its description; its sub-issues; and the issues it is blocked by ' +
        'and those it blocks',
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
    .option('--json', 'print the issues as a JSON array of objects')
    .action(async (options: { all?: boolean; status?: string[]; json?: boolean }) => {
      const { issues } = answered(await connect().listIssues())
      const statuses = options.status?.map((name) => statusNamed(name))
      const listed = listOrder(issues, 'all').filter((issue) =>
        statuses === undefined
          ? options.all === true || isIssueOpen(issue)
          : statuses.includes(issue.status),
      )
      io.write(options.json ? jsonText(listed.map(issueJson)) : issueListText(listed))
    })

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
          }),
        )
        io.write(options.json ? jsonText(issueJson(created)) : `${issueIdentifier(created.id)}\n`)
      },
    )

  issueCommand
    .command('edit')
    .description(
      'Change the parent, the sub-issues and the dependencies of an issue, all together or, when ' +
        `one of the changes cannot be made, not at all, and print its identifier. An issue has at ` +
        `most ${MAX_SUB_ISSUES} sub-issues and is at most ${MAX_SUB_ISSUE_LEVEL} levels below a ` +
        'top-level issue, and cannot be below itself. An issue waits for the issues it is blocked ' +
        `by and, as a parent, for its sub-issues; it is blocked by at most ${MAX_BLOCKED_BY} ` +
        `issues and blocks at most ${MAX_BLOCKING}, cannot be blocked by an issue above or below ` +
        'it, and cannot wait for itself',
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
        if (Object.keys(edit).length === 0) {
          throw new CliError(
            'Nothing to change: give --parent, --remove-parent, --add-sub-issue, ' +
              '--remove-sub-issue, --add-blocked-by, --remove-blocked-by, --add-blocking or ' +
              '--remove-blocking.',
          )
        }
        const { issue: edited } = answered(await connect().editIssue(digits, edit))
        io.write(`${issueIdentifier(edited.id)}\n`)
      },
    )

  issueCommand
    .command('split')
    .description(
      'Split an issue: create the issues a JSON file lists as its last sub-issues, in order, ' +
        'each blocked by the issues it lists and blocking others, all together or, when one of ' +
        'them cannot be created, none; and print their identifiers, in order. Each is created as ' +
        '"hoot issue create --parent <issue>" creates one, with the same rules',
    )
    .argument('<issue>', "the issue's identifier, such as ISS-12, or its number, such as 12")
    .requiredOption(
      '--file <file>',
      'read the issues from a UTF-8 file, or from standard input with -: a JSON array with an ' +
        'object for each issue, with "title", and optionally "description", "status" and ' +
        '"priority" (by their names), "blockedBy", the issues it is blocked by, and "blocking", ' +
        'those it blocks: arrays of the places of other issues in the array, from 1, and the ' +
        'identifiers of issues of the project, such as "ISS-12"',
    )
    .option(
      '--json',
      'print the new issues as a JSON array of objects instead of their identifiers',
    )
    .action(async (text: string, options: { file: string; json?: boolean }) => {
      const digits = givenIssue(text)
      const source = options.file === '-' ? 'standard input' : options.file
      const issues = splitIssues(await readText(options.file, 'issues'), source)
      const { issues: created } = answered(await connect().split(digits, issues))
      io.write(
        options.json
          ? jsonText(created.map(issueJson))
          : created.map((issue) => `${issueIdentifier(issue.id)}\n`).join(''),
      )
    })

  const stepCommand: Command = program
    .command('step')
    .description('Report the steps of the workflow of the issue that this session was started from')
    .addHelpText('after', () =>
      stepCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  stepCommand
    .command('report')
    .description(
      'Report the outcome of the current step, with a summary of what the step found, ' +
        'and print what to do next: the next step, or that the workflow is finished',
    )
    .argument('<outcome>', 'the name of one of the outcomes of the current step')
    .addOption(new Option('--summary <text>', 'the summary, in Markdown').conflicts('summaryFile'))
    .option(
      '--summary-file <file>',
      'read the summary from a UTF-8 file, or from standard input with -',
    )
    .action(async (outcome: string, options: { summary?: string; summaryFile?: string }) => {
      const summary =
        options.summaryFile === undefined
          ? options.summary
          : await readText(options.summaryFile, 'summary')
      if (summary === undefined) {
        throw new CliError(
          'No summary was given: give it with --summary <text> or --summary-file <file>.',
        )
      }
      if (summary.trim() === '') throw new CliError('The summary is empty, or only whitespace.')
      if (summary.length > STEP_SUMMARY_MAX_LENGTH) {
        throw new CliError(
          `The summary is ${quantity.format(summary.length)} characters long; ` +
            `Hoot saves summaries of up to ${quantity.format(STEP_SUMMARY_MAX_LENGTH)}.`,
        )
      }
      const { report } = answered(await connect().reportStep({ outcome, summary }))
      io.write(stepReportText(report))
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
