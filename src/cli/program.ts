import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import { HOOT_ENV, type HootAnswer, type IssueEdit } from '../shared/hoot-cli'
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
 * Builds hoot's commands: `hoot issue view`, `list`, `create` and `edit`,
 * modeled on `gh issue`, which read or create the issues of the project of
 * the Hoot session hoot runs in, and change their parents and sub-issues; and
 * `hoot step report`, which reports a step of the workflow of the issue the
 * session was started from. Each works through the Hoot that started the
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
        'their parents and sub-issues, and report the steps of the workflow of the issue the ' +
        'session was started from.',
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
      "Show, list and create the issues of the session's project, and change their parents and sub-issues",
    )
    // Every command's usage, so that this help says all there is.
    .addHelpText('after', () =>
      issueCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  issueCommand
    .command('view')
    .description(
      'Show an issue: its identifier and title; its status, priority and creation time; the issue ' +
        'it is a sub-issue of; its description; and its sub-issues',
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
          json?: boolean
        },
        command: Command,
      ) => {
        const { title } = options
        const parent = options.parent === undefined ? undefined : givenIssue(options.parent)
        if (title.length > ISSUE_TITLE_MAX_LENGTH) {
          throw new CliError(
            `The title is ${quantity.format(title.length)} characters long; ` +
              `Hoot saves titles of up to ${quantity.format(ISSUE_TITLE_MAX_LENGTH)}.`,
          )
        }
        if (issueTitle(title) === '') throw new CliError('The title is empty: an issue needs one.')
        const description =
          options.descriptionFile === undefined
            ? (options.description ?? '')
            : await readText(options.descriptionFile, 'description')
        if (description.length > ISSUE_DESCRIPTION_MAX_LENGTH) {
          throw new CliError(
            `The description is ${quantity.format(description.length)} characters long; ` +
              `Hoot saves descriptions of up to ${quantity.format(ISSUE_DESCRIPTION_MAX_LENGTH)}.`,
          )
        }
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
          }),
        )
        io.write(options.json ? jsonText(issueJson(created)) : `${issueIdentifier(created.id)}\n`)
      },
    )

  issueCommand
    .command('edit')
    .description(
      'Change the parent and the sub-issues of an issue, all together or, when one of the ' +
        `changes cannot be made, not at all, and print its identifier. An issue has at most ` +
        `${MAX_SUB_ISSUES} sub-issues and is at most ${MAX_SUB_ISSUE_LEVEL} levels below a ` +
        'top-level issue, and cannot be below itself',
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
    .action(
      async (
        text: string,
        options: {
          parent?: string
          removeParent?: boolean
          addSubIssue?: string
          removeSubIssue?: string
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
        if (Object.keys(edit).length === 0) {
          throw new CliError(
            'Nothing to change: give --parent, --remove-parent, --add-sub-issue or --remove-sub-issue.',
          )
        }
        const { issue: edited } = answered(await connect().editIssue(digits, edit))
        io.write(`${issueIdentifier(edited.id)}\n`)
      },
    )

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
