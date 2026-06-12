import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

const mockReadFileSync = jest.fn<typeof import('fs').readFileSync>()

jest.unstable_mockModule('fs', () => ({
  readFileSync: mockReadFileSync
}))

jest.unstable_mockModule('@actions/core', () => core)

const { run } = await import('../src/main.js')

const AGENT_YAML = `
name: My Test Agent
description: A test agent
model: claude-opus-4-6
`

const AGENT_YAML_WITH_VERSION = `
name: My Test Agent
description: A test agent
model: claude-opus-4-6
version: 3
`

const AGENT_YAML_WITH_ID = `
id: agent_from_config
name: My Test Agent
description: A test agent
model: claude-opus-4-6
`

const AGENT_YAML_WITH_MATCHING_ID = `
id: agent_abc123
name: My Test Agent
description: A test agent
model: claude-opus-4-6
`

const mockFetch = jest.fn<typeof fetch>()

describe('main.ts', () => {
  beforeEach(() => {
    global.fetch = mockFetch

    core.getBooleanInput.mockReturnValue(false)

    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'agent_id':
          return 'agent_abc123'
        case 'config_file':
          return 'agent.yml'
        case 'anthropic_api_key':
          return 'sk-ant-test'
        default:
          return ''
      }
    })

    mockReadFileSync.mockReturnValue(AGENT_YAML)

    // Default: GET succeeds with version 5
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'agent_abc123',
        version: 5,
        name: 'My Test Agent'
      })
    } as Response)

    // Default: POST succeeds returning version 6
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'agent_abc123',
        version: 6,
        name: 'My Test Agent'
      })
    } as Response)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('GETs the current version then POSTs the update', async () => {
    await run()

    expect(mockFetch).toHaveBeenCalledTimes(2)

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.anthropic.com/v1/agents/agent_abc123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'managed-agents-2026-04-01',
          'X-Api-Key': 'sk-ant-test'
        })
      })
    )

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/v1/agents/agent_abc123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'managed-agents-2026-04-01',
          'X-Api-Key': 'sk-ant-test'
        }),
        body: expect.stringContaining('"version":5')
      })
    )
  })

  it('sets the version output to the new version', async () => {
    await run()

    expect(core.setOutput).toHaveBeenCalledWith('version', '6')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('uses version from config file and skips GET when version is specified', async () => {
    mockReadFileSync.mockReturnValue(AGENT_YAML_WITH_VERSION)
    mockFetch.mockReset()

    // Only one fetch call expected (the POST)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'agent_abc123',
        version: 3,
        name: 'My Test Agent'
      })
    } as Response)

    await run()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/agents/agent_abc123',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"version":3')
      })
    )
    expect(core.warning).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('version', '3')
  })

  it('fails and skips the update when GET returns a non-OK status', async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '{"error":{"message":"Agent not found"}}'
    } as Response)

    await run()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get agent agent_abc123')
    )
  })

  it('fails when the POST update returns a non-OK status', async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'agent_abc123', version: 5 })
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => '{"error":{"message":"Invalid config"}}'
    } as Response)

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update agent agent_abc123')
    )
  })

  it('uses the id from the config file when agent_id input is omitted', async () => {
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'config_file':
          return 'agent.yml'
        case 'anthropic_api_key':
          return 'sk-ant-test'
        default:
          return ''
      }
    })
    mockReadFileSync.mockReturnValue(AGENT_YAML_WITH_ID)

    await run()

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.anthropic.com/v1/agents/agent_from_config',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/v1/agents/agent_from_config',
      expect.objectContaining({ method: 'POST' })
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('does not send the config id in the update body', async () => {
    mockReadFileSync.mockReturnValue(AGENT_YAML_WITH_MATCHING_ID)

    await run()

    const postBody = JSON.parse(
      (mockFetch.mock.calls[1][1] as RequestInit).body as string
    )
    expect(postBody.id).toBeUndefined()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('sets the agent_id output when updating', async () => {
    await run()

    expect(core.setOutput).toHaveBeenCalledWith('agent_id', 'agent_abc123')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('creates a new agent when no ID is provided and allow_creation is true', async () => {
    core.getBooleanInput.mockReturnValue(true)
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'config_file':
          return 'agent.yml'
        case 'anthropic_api_key':
          return 'sk-ant-test'
        default:
          return ''
      }
    })
    mockReadFileSync.mockReturnValue(AGENT_YAML)
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'agent_new456',
        version: 1,
        name: 'My Test Agent'
      })
    } as Response)

    await run()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/agents',
      expect.objectContaining({ method: 'POST' })
    )
    expect(core.setOutput).toHaveBeenCalledWith('agent_id', 'agent_new456')
    expect(core.setOutput).toHaveBeenCalledWith('version', '1')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('strips the version field and warns when creating an agent', async () => {
    core.getBooleanInput.mockReturnValue(true)
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'config_file':
          return 'agent.yml'
        case 'anthropic_api_key':
          return 'sk-ant-test'
        default:
          return ''
      }
    })
    mockReadFileSync.mockReturnValue(AGENT_YAML_WITH_VERSION)
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'agent_new456', version: 1 })
    } as Response)

    await run()

    const createBody = JSON.parse(
      (mockFetch.mock.calls[0][1] as RequestInit).body as string
    )
    expect(createBody.version).toBeUndefined()
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('version')
    )
  })

  it('fails when agent creation returns a non-OK status', async () => {
    core.getBooleanInput.mockReturnValue(true)
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'config_file':
          return 'agent.yml'
        case 'anthropic_api_key':
          return 'sk-ant-test'
        default:
          return ''
      }
    })
    mockReadFileSync.mockReturnValue(AGENT_YAML)
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":{"message":"Invalid config"}}'
    } as Response)

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create agent')
    )
  })

  it('fails when neither agent_id input nor config id is provided', async () => {
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'config_file':
          return 'agent.yml'
        case 'anthropic_api_key':
          return 'sk-ant-test'
        default:
          return ''
      }
    })
    mockReadFileSync.mockReturnValue(AGENT_YAML)

    await run()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('No agent ID provided')
    )
  })

  it('fails when agent_id input conflicts with the config id', async () => {
    mockReadFileSync.mockReturnValue(AGENT_YAML_WITH_ID)

    await run()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('does not match id')
    )
  })

  it('fails when the config file contains invalid YAML', async () => {
    mockReadFileSync.mockReturnValue(null)

    await run()

    expect(core.setFailed).toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
