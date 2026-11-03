// Agent definitions: the CLI command, its npm package and the env var for its API key.
export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    keyEnv: 'ANTHROPIC_API_KEY',
    color: '#d97757'
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    npmPackage: '@openai/codex',
    keyEnv: 'OPENAI_API_KEY',
    color: '#10a37f'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    npmPackage: '@google/gemini-cli',
    keyEnv: 'GEMINI_API_KEY',
    color: '#4285f4'
  }
}
