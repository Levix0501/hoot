import {
  bareModel,
  catalogModelOf,
  codexEffortsOf,
  codexSessionEffort,
  providerFirstModel,
  providerUrl,
  type ModelCatalogs,
  type Provider,
} from '../../shared/providers'

/** The id under which Hoot gives a Codex session a provider of the user's. */
export const CODEX_PROVIDER_ID = 'hoot'

/** The variable a Codex session on a provider of the user's takes its key from. */
export const CODEX_KEY_VARIABLE = 'HOOT_CODEX_API_KEY'

/** A string as TOML writes it, in double quotes. */
export function tomlString(text: string): string {
  return JSON.stringify(text)
}

/**
 * The arguments, and the variables, that run a Codex session on a provider:
 * one of the user's as Hoot's own `model_provider`, at its Responses address,
 * its key in a variable of the session's rather than among its arguments,
 * with its model, else the one its agent starts with (see
 * `providerFirstModel`), and an effort level always, so that the user's own,
 * which Codex would send the provider as it is, does not apply: its agent's,
 * else the model's (see `codexSessionEffort`). For Codex's own sign-in,
 * OpenAI's provider, whatever the user's configuration names. Codex's own
 * configuration is neither read nor written.
 */
export function codexProviderLaunch(
  provider: Provider,
  model: string | null,
  effort: string | null,
  catalogs: ModelCatalogs,
): { args: string[]; env: Record<string, string>; model: string | null; effort: string | null } {
  if (provider.own !== null) {
    return { args: ['-c', 'model_provider="openai"'], env: {}, model, effort }
  }
  const table =
    `{name=${tomlString(provider.name)},` +
    `base_url=${tomlString(providerUrl(provider, 'codex'))},` +
    `env_key=${tomlString(CODEX_KEY_VARIABLE)},wire_api="responses"}`
  const picked = model ?? providerFirstModel('codex', provider, catalogs)
  const levels =
    picked === null ? [] : codexEffortsOf(catalogModelOf(catalogs, 'codex', provider, picked))
  return {
    args: [
      '-c',
      `model_provider=${tomlString(CODEX_PROVIDER_ID)}`,
      '-c',
      `model_providers.${CODEX_PROVIDER_ID}=${table}`,
    ],
    env: { [CODEX_KEY_VARIABLE]: provider.apiKey },
    model: picked === null ? null : bareModel(picked),
    effort: codexSessionEffort(effort, levels),
  }
}
