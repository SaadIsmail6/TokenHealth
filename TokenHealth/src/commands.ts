import type { BotCommand } from '@towns-protocol/bot'

const commands = [
    {
        name: 'help',
        description: 'Show TokenHealth usage and features',
    },
    {
        name: 'health',
        description: 'Check the safety of a token or contract address',
    },
] as const satisfies BotCommand[]

export default commands












