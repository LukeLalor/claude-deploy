# Deploy Claude Agent

A GitHub Action to deploy
[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)
from version control.

## Why?

Managed agents are HTTP services. Like any other service, their configuration
should live in version control. The fact that instructions are written in prose
instead of code doesn't change this. Agents as code.

## Example

Deploys your agent whenever its config file changes on `main`.

### .github/workflows/deploy_agent.yml

```yaml
name: Deploy Claude Agent

on:
  push:
    branches: [main]
    paths: [agents/**]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy agent
        id: deploy
        uses: LukeLalor/claude-deploy@v1
        with:
          config_file: agents/my-agent.yml
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}

      - run: echo "Deployed version ${{ steps.deploy.outputs.version }}"
```

### agents/my-agent.yml

```yaml
id: agent_abc123
name: My Agent
description: Does something useful
model:
  id: claude-opus-4-6
  speed: standard
system: You are a helpful assistant.
```

The agent to update is identified by the `id` field in the config file.
Alternatively, omit `id` and pass the `agent_id` input instead (e.g.
`agent_id: ${{ vars.AGENT_ID }}`). If both are set they must match.

To bootstrap your config file from an existing agent:

```bash
curl -s https://api.anthropic.com/v1/agents/$AGENT_ID -H 'anthropic-version: 2023-06-01' -H 'anthropic-beta: managed-agents-2026-04-01' -H "X-Api-Key: $ANTHROPIC_API_KEY" | yq -p json -o yaml 'del(.version)' > agents/my-agent.yml
```

## Inputs

| Input               | Required | Description                                                             |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `agent_id`          | No       | The ID of the agent to update. Optional if the config file has an `id`  |
| `config_file`       | Yes      | Path to the agent YAML config file (relative to repository root)        |
| `anthropic_api_key` | Yes      | Anthropic API key with permission to manage agents                      |
| `allow_creation`    | No       | Create a new agent when no agent ID is provided anywhere. Default false |

## Outputs

| Output     | Description                            |
| ---------- | -------------------------------------- |
| `agent_id` | The ID of the agent created or updated |
| `version`  | The agent version after the update     |

## Creating agents

With `allow_creation: true`, the action creates a new agent when no agent ID is
provided via the `agent_id` input or the config file's `id` field. The new
agent's ID is available in the `agent_id` output — add it to your config file
(or store it as a repository variable) so subsequent runs update the same agent
instead of creating another one.

## Pinning a version

By default the action fetches the current version from the API automatically and
passes it through with the update. To control versioning yourself, include
`version` explicitly in your config file. Note that update operations will fail
if the version is out of date, so opting in to this means you are responsible
for keeping it in sync.

```yaml
name: My Agent
model:
  id: claude-opus-4-6
  speed: standard
system: You are a helpful assistant.
version: 4
```
