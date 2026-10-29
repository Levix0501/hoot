import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, type ParseError } from 'jsonc-parser'
import { envVariable, type Env } from '../env/env'

/**
 * The variable OpenCode 2, from 2.0.6 on, takes the settings of its terminal
 * interface from, over those of its cli.json: an object in it is merged with
 * the file's, and any other value, a list of plugins among them, replaces the
 * file's. OpenCode 1.x leaves it aside.
 */
export const OPENCODE_CLI_CONFIG = 'OPENCODE_CLI_CONFIG_CONTENT'

export interface OpenCodePluginFolderOptions {
  /** Whether this Hoot runs packaged, rather than from its repository. */
  packaged: boolean
  /** The packaged app's folder of resources. */
  resourcesPath: string
  /** The folder of the app: the repository, for a Hoot run from it. */
  appPath: string
  platform?: NodeJS.Platform
}

/**
 * The folder of the plugin Hoot gives OpenCode, which OpenCode loads from
 * there: in the packaged app's resources, out of its archive, or in the
 * repository, for a Hoot run from it.
 */
export function openCodePluginFolder(options: OpenCodePluginFolderOptions): string {
  const paths = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix
  return options.packaged
    ? paths.join(options.resourcesPath, 'opencode-plugin')
    : paths.join(options.appPath, 'resources', 'opencode-plugin')
}

/**
 * The folder OpenCode 2 keeps its own settings in, cli.json among them, as
 * it finds it in the environment it runs with in the folder `cwd`:
 * OPENCODE_CONFIG_DIR, or else `opencode` in XDG_CONFIG_HOME, or else in
 * `.config` in the home folder, on Windows too.
 */
export function openCodeConfigFolder(
  env: Env,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const given = envVariable(env, 'OPENCODE_CONFIG_DIR', platform)
  if (given !== undefined) return paths.resolve(cwd, given)
  const home = envVariable(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform)
  const config =
    envVariable(env, 'XDG_CONFIG_HOME', platform) || paths.join(home || os.homedir(), '.config')
  return paths.resolve(cwd, config, 'opencode')
}

/**
 * An entry of a list of plugins as OpenCode takes one: the name of a package,
 * a path to a folder, `-` and the id of plugins to turn off, or an object
 * with one of the first two and the plugin's options.
 */
type PluginEntry = string | { package: string; options?: Record<string, unknown> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPluginEntry(value: unknown): value is PluginEntry {
  if (typeof value === 'string') return true
  if (!isRecord(value) || typeof value.package !== 'string') return false
  return value.options === undefined || isRecord(value.options)
}

/**
 * Settings written as OpenCode writes them, JSON with comments and trailing
 * commas, when they are an object; `undefined` when they are not.
 */
function settingsObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  return errors.length === 0 && isRecord(value) ? value : undefined
}

/**
 * The plugins that settings list; `undefined` when they list none, and
 * `null` when OpenCode would leave the settings aside for them.
 */
function pluginsOf(settings: Record<string, unknown>): PluginEntry[] | undefined | null {
  const plugins: unknown = settings.plugins
  if (plugins === undefined) return undefined
  return Array.isArray(plugins) && plugins.every(isPluginEntry) ? plugins : null
}

/**
 * Whether OpenCode would take settings, as far as the keys Hoot gives go: a
 * list of plugins it takes, and an object for its tab strip. It leaves
 * settings aside altogether for a value it does not take.
 */
function takenByOpenCode(settings: Record<string, unknown>): boolean {
  return pluginsOf(settings) !== null && (settings.tabs === undefined || isRecord(settings.tabs))
}

/**
 * The plugins the user's cli.json lists, in its folder; none when it cannot
 * be read, or OpenCode would leave it aside. It is decoded as OpenCode
 * decodes it, without the byte order mark that Windows PowerShell 5.1 and
 * older versions of Notepad put at the start of a UTF-8 file.
 */
async function cliJsonPlugins(configFolder: string): Promise<PluginEntry[]> {
  let bytes: Uint8Array
  try {
    bytes = await fs.readFile(path.join(configFolder, 'cli.json'))
  } catch {
    return []
  }
  const settings = settingsObject(new TextDecoder().decode(bytes))
  if (settings === undefined || !takenByOpenCode(settings)) return []
  return pluginsOf(settings) ?? []
}

/**
 * What OpenCode tells the plugins of a list apart by: the URL of the folder a
 * path names, with a relative one taken from the folder of cli.json, or else
 * the entry as it is.
 */
function pluginKey(entry: PluginEntry, configFolder: string): string {
  const spec = typeof entry === 'string' ? entry : entry.package
  try {
    if (spec.startsWith('file://')) return new URL(spec).href
    if (spec.startsWith('./') || spec.startsWith('../') || path.isAbsolute(spec)) {
      return pathToFileURL(path.resolve(configFolder, spec)).href
    }
  } catch {
    // An entry OpenCode takes for no folder of a plugin.
  }
  return spec
}

export interface OpenCodeCliConfigOptions {
  /** The environment OpenCode runs with, which the user's own settings come from. */
  env: Env
  /** The folder OpenCode runs in. */
  cwd: string
  /** The folder of the plugin Hoot gives OpenCode. */
  plugin: string
  platform?: NodeJS.Platform
}

/**
 * The OPENCODE_CLI_CONFIG_CONTENT of an OpenCode session Hoot starts: the
 * user's own, when OpenCode would take it, with OpenCode's own tab strip
 * turned off, by `tabs.mode` for OpenCode 2.0.13 and later and by
 * `tabs.enabled` for earlier versions, which leave `tabs.mode` aside, and
 * with Hoot's plugin first in its list of plugins. The user's own plugins
 * follow, those that variable lists, or else those of cli.json, which the
 * variable's list would replace, as they are and in their order: an entry
 * that turns plugins off, as `-hoot` does, turns Hoot's off too, and one that
 * names Hoot's plugin itself, as `opencode plugin add` writes into cli.json
 * in a session of Hoot's, stays where it is, without Hoot's before it. Hoot
 * only reads cli.json, which it never writes.
 */
export async function openCodeCliConfig(options: OpenCodeCliConfigOptions): Promise<string> {
  const platform = options.platform ?? process.platform
  const configFolder = openCodeConfigFolder(options.env, options.cwd, platform)
  let own = settingsObject(envVariable(options.env, OPENCODE_CLI_CONFIG, platform))
  // As OpenCode leaves settings aside that it does not take.
  if (own !== undefined && !takenByOpenCode(own)) own = undefined
  const entries = (own && pluginsOf(own)) ?? (await cliJsonPlugins(configFolder))
  const hoot = pluginKey(options.plugin, configFolder)
  const plugins = entries.some((entry) => pluginKey(entry, configFolder) === hoot)
    ? entries
    : [options.plugin, ...entries]
  const base = own ?? {}
  const tabs = isRecord(base.tabs) ? base.tabs : {}
  return JSON.stringify({ ...base, tabs: { ...tabs, mode: 'off', enabled: false }, plugins })
}
