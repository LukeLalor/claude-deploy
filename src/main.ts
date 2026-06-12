import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'managed-agents-2026-04-01',
    'X-Api-Key': apiKey
  }
}

export async function run(): Promise<void> {
  try {
    const agentIdInput = core.getInput('agent_id')
    const configFile = core.getInput('config_file', { required: true })
    const apiKey = core.getInput('anthropic_api_key', { required: true })
    const allowCreation = core.getBooleanInput('allow_creation')

    const workspace = process.env.GITHUB_WORKSPACE ?? '.'
    const filePath = path.resolve(workspace, configFile)

    core.info(`Reading agent configuration from ${filePath}`)
    const fileContent = fs.readFileSync(filePath, 'utf-8')

    const agentConfig = yaml.load(fileContent) as Record<string, unknown>
    if (!agentConfig || typeof agentConfig !== 'object') {
      throw new Error(`Invalid or empty YAML in ${configFile}`)
    }

    const configId =
      typeof agentConfig.id === 'string' ? agentConfig.id : undefined

    if (agentIdInput && configId && agentIdInput !== configId) {
      throw new Error(
        `agent_id input (${agentIdInput}) does not match id in ${configFile} (${configId}). ` +
          `Remove one of them or make them match.`
      )
    }

    const headers = buildHeaders(apiKey)

    const agentId = agentIdInput || configId
    if (!agentId) {
      if (!allowCreation) {
        throw new Error(
          `No agent ID provided. Set the agent_id input, add an id field to ${configFile}, ` +
            `or set allow_creation to create a new agent.`
        )
      }

      core.info('No agent ID provided. Creating a new agent...')
      const createBody: Record<string, unknown> = { ...agentConfig }
      if ('version' in createBody) {
        core.warning('Ignoring version field in config when creating an agent')
        delete createBody.version
      }

      const createResponse = await fetch(`${ANTHROPIC_API_BASE}/agents`, {
        method: 'POST',
        headers,
        body: JSON.stringify(createBody)
      })

      if (!createResponse.ok) {
        const body = await createResponse.text()
        throw new Error(
          `Failed to create agent: ${createResponse.status} ${createResponse.statusText}\n${body}`
        )
      }

      const createdAgent = (await createResponse.json()) as Record<
        string,
        unknown
      >
      const createdId = createdAgent.id as string
      const createdVersion = createdAgent.version as number
      core.info(
        `Agent ${createdId} created successfully. Version: ${createdVersion}`
      )
      core.setOutput('agent_id', createdId)
      core.setOutput('version', String(createdVersion))
      return
    }

    const agentUrl = `${ANTHROPIC_API_BASE}/agents/${agentId}`

    let version: number

    if ('version' in agentConfig) {
      version = agentConfig.version as number
      core.info(`Using version ${version} from config file`)
    } else {
      // GET current agent to obtain the version required for updates
      core.info(`Fetching current agent version for ${agentId}...`)
      const getResponse = await fetch(agentUrl, { method: 'GET', headers })

      if (!getResponse.ok) {
        const body = await getResponse.text()
        throw new Error(
          `Failed to get agent ${agentId}: ${getResponse.status} ${getResponse.statusText}\n${body}`
        )
      }

      const currentAgent = (await getResponse.json()) as Record<string, unknown>
      version = currentAgent.version as number
      core.info(`Current agent version: ${version}`)
    }

    // Build update body: config + resolved version (overrides any version in
    // config). The agent ID is part of the URL, so drop it from the body.
    const updateBody: Record<string, unknown> = { ...agentConfig, version }
    delete updateBody.id

    // POST to update the agent
    core.info(`Updating agent ${agentId}...`)
    const postResponse = await fetch(agentUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(updateBody)
    })

    if (!postResponse.ok) {
      const body = await postResponse.text()
      throw new Error(
        `Failed to update agent ${agentId}: ${postResponse.status} ${postResponse.statusText}\n${body}`
      )
    }

    const updatedAgent = (await postResponse.json()) as Record<string, unknown>
    const newVersion = updatedAgent.version as number
    core.info(
      `Agent ${agentId} updated successfully. New version: ${newVersion}`
    )
    core.setOutput('agent_id', agentId)
    core.setOutput('version', String(newVersion))
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
