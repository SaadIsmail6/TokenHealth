// Those commands will be registered to the bot as soon as the bot is initialized
// and will be available in the slash command autocomplete.
const commands = [
    {
        name: 'help',
        description: 'Show TokenHealth usage and features',
    },
    {
        name: 'health',
        description: 'Check the safety of a token or contract address',
    },
]

export default commands

