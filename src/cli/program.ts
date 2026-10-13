import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import { HOOT_ENV, type HootAnswer } from '../shared/hoot-cli'
import {
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  isIssueOpen,
  issueIdentifier,
  issueTitle,
  listOrder,
  projectKey,
} from '../shared/issues'
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

/** An issue as given on the command line: its number, and its project's key with an identifier. */
export interface IssueReference {
  /** The key an identifier starts with, such as "HOO"; `null` for a bare number. */
  key: string | null
  /** The number, in decimal digits as given. */
  digits: string
}

/** Reads an identifier, such as "HOO-12", or a number, such as "12"; `null` for anything else. */
export function parseIssueReference(text: string): IssueReference | null {
  const match = /^(?:([A-Za-z0-9]+)-)?(\d+)$/.exec(text)
  return match ? { key: match[1] ?? null, digits: match[2]! } : null
}

const quantity = new Intl.NumberFormat('en-US')

/** What Hoot answered, or a `CliError` with why it could not do what was asked. */
function answered<T extends HootAnswer<object>>(answer: T): Extract<T, { ok: true }> {
  if (!answer.ok) throw new CliError(answer.message)
  return answer as Extract<T, { ok: true }>
}

/** Text decoded as UTF-8, kept exactly as it is, byte order mark included. */
function utf8Text(bytes: Uint8Array, source: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new CliError(`The description in ${source} is not UTF-8 text.`)
  }
}

/**
 * Builds hoot's commands: `hoot issue view`, `list` and `create`, modeled on
 * `gh issue`. Each reads or creates the issues of the project of the Hoot
 * session hoot runs in, through the Hoot that started the session.
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

  const readDescription = async (file: string): Promise<string> => {
    const source = file === '-' ? 'standard input' : file
    let bytes: Uint8Array
    try {
      bytes = file === '-' ? await io.readStdin() : await io.readFile(file)
    } catch (error) {
      throw new CliError(
        `Could not read the description from ${source}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return utf8Text(bytes, source)
  }

  const program = new Command('hoot')
    .description('Read and create the issues of the project of the Hoot session that hoot runs in.')
    .configureOutput({
      writeOut: (text) => io.write(text),
      writeErr: (text) => io.writeError(text),
    })
    .exitOverride()
    .addHelpText(
      'after',
      '\nRun "hoot issue --help" for the issue commands, their options, and the names of the statuses and priorities.',
    )

  const issueCommand: Command = program
    .command('issue')
    .description("Show, list and create the issues of the session's project")
    // Every command's usage, so that this help says all there is.
    .addHelpText('after', () =>
      issueCommand.commands.map((command) => `\n${command.helpInformation()}`).join(''),
    )

  issueCommand
    .command('view')
    .description(
      'Show an issue: its identifier and title; its status, priority and creation time; and its description',
    )
    .argument('<issue>', "the issue's identifier, such as HOO-12, or its number, such as 12")
    .option('--json', 'print the issue as a JSON object')
    .action(async (text: string, options: { json?: boolean }) => {
      const reference = parseIssueReference(text)
      if (reference === null) {
        throw new CliError(
          `"${text}" is neither an issue's identifier, such as HOO-12, nor its number, such as 12.`,
        )
      }
      const { project, issue: found } = answered(await connect().issue(reference.digits))
      const key = projectKey(project.name)
      if (found === null || (reference.key !== null && reference.key !== key)) {
        const asked = reference.key === null ? `${key}-${reference.digits}` : text
        throw new CliError(`There is no issue ${asked} in this session's project, ${project.name}.`)
      }
      io.write(
        options.json ? jsonText(issueJson(project.name, found)) : issueText(project.name, found),
      )
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
      const { project, issues } = answered(await connect().listIssues())
      const statuses = options.status?.map((name) => statusNamed(name))
      const listed = listOrder(issues, 'all').filter((issue) =>
        statuses === undefined
          ? options.all === true || isIssueOpen(issue)
          : statuses.includes(issue.status),
      )
      io.write(
        options.json
          ? jsonText(listed.map((issue) => issueJson(project.name, issue)))
          : issueListText(project.name, listed),
      )
    })

  issueCommand
    .command('create')
    .description("Create an issue in the session's project, and print its identifier")
    .requiredOption('--title <title>', 'the title, saved without the whitespace around it')
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
      new Option('--priority <name>', 'the priority').choices(PRIORITY_NAME_LIST).default('none'),
    )
    .option('--json', 'print the new issue as a JSON object instead of its identifier')
    .action(
      async (options: {
        title: string
        description?: string
        descriptionFile?: string
        status: string
        priority: string
        json?: boolean
      }) => {
        const { title } = options
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
            : await readDescription(options.descriptionFile)
        if (description.length > ISSUE_DESCRIPTION_MAX_LENGTH) {
          throw new CliError(
            `The description is ${quantity.format(description.length)} characters long; ` +
              `Hoot saves descriptions of up to ${quantity.format(ISSUE_DESCRIPTION_MAX_LENGTH)}.`,
          )
        }
        const { project, issue: created } = answered(
          await connect().createIssue({
            title,
            description,
            status: statusNamed(options.status)!,
            priority: priorityNamed(options.priority)!,
          }),
        )
        io.write(
          options.json
            ? jsonText(issueJson(project.name, created))
            : `${issueIdentifier(project.name, created.number)}\n`,
        )
      },
    )

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
