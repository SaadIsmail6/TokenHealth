import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands'
import { isAddress } from 'viem'

// Address type detection
type AddressType = 'evm' | 'solana' | 'invalid'

function detectAddressType(address: string): AddressType {
    // Solana addresses are base58 encoded, typically 32-44 characters
    // Common patterns: starts with letters/numbers, no 0x prefix
    const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    
    if (address.startsWith('0x') && isAddress(address)) {
        return 'evm'
    }
    
    if (solanaPattern.test(address)) {
        return 'solana'
    }
    
    return 'invalid'
}

// API Functions
async function fetchGoPlusData(address: string) {
    try {
        // GoPlus Security API - Token Security endpoint
        const response = await fetch(
            `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${address}`,
            {
                headers: {
                    'Accept': 'application/json',
                },
            },
        )

        if (!response.ok) {
            throw new Error(`GoPlus API error: ${response.status}`)
        }

        const data = await response.json()
        return data.result?.[address.toLowerCase()] || null
    } catch (error) {
        console.error('GoPlus API error:', error)
        return null
    }
}

async function fetchEtherscanData(address: string) {
    try {
        // Try Etherscan first (Ethereum mainnet)
        const etherscanApiKey = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken'
        
        // Fetch contract creation and token info in parallel
        const [creationResponse, tokenResponse] = await Promise.all([
            fetch(
                `https://api.etherscan.io/api?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${etherscanApiKey}`,
            ),
            fetch(
                `https://api.etherscan.io/api?module=token&action=tokeninfo&contractaddress=${address}&apikey=${etherscanApiKey}`,
            ),
        ])

        if (creationResponse.ok) {
            const creationData = await creationResponse.json()
            let tokenName = null
            
            if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json()
                if (tokenData.status === '1' && tokenData.result?.[0]) {
                    tokenName = tokenData.result[0].tokenName || null
                }
            }
            
            if (creationData.status === '1' && creationData.result?.[0]) {
                return {
                    chain: 'Ethereum',
                    creationTx: creationData.result[0].txHash,
                    creator: creationData.result[0].contractCreator,
                    source: 'etherscan',
                    tokenName,
                }
            }
        }

        // Try Basescan (Base chain)
        const basescanApiKey = process.env.BASESCAN_API_KEY || 'YourApiKeyToken'
        const [baseCreationResponse, baseTokenResponse] = await Promise.all([
            fetch(
                `https://api.basescan.org/api?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${basescanApiKey}`,
            ),
            fetch(
                `https://api.basescan.org/api?module=token&action=tokeninfo&contractaddress=${address}&apikey=${basescanApiKey}`,
            ),
        ])

        if (baseCreationResponse.ok) {
            const creationData = await baseCreationResponse.json()
            let tokenName = null
            
            if (baseTokenResponse.ok) {
                const tokenData = await baseTokenResponse.json()
                if (tokenData.status === '1' && tokenData.result?.[0]) {
                    tokenName = tokenData.result[0].tokenName || null
                }
            }
            
            if (creationData.status === '1' && creationData.result?.[0]) {
                return {
                    chain: 'Base',
                    creationTx: creationData.result[0].txHash,
                    creator: creationData.result[0].contractCreator,
                    source: 'basescan',
                    tokenName,
                }
            }
        }

        return null
    } catch (error) {
        console.error('Etherscan/Basescan API error:', error)
        return null
    }
}

async function fetchSolscanData(address: string) {
    try {
        // Solscan API - Token meta endpoint
        const response = await fetch(
            `https://api.solscan.io/token/meta?token=${address}`,
            {
                headers: {
                    'Accept': 'application/json',
                },
            },
        )

        if (!response.ok) {
            throw new Error(`Solscan API error: ${response.status}`)
        }

        const data = await response.json()
        
        if (data) {
            return {
                chain: 'Solana',
                tokenName: data.tokenName || data.name || data.tokenSymbol || 'Unknown',
                tokenSymbol: data.tokenSymbol || data.symbol || 'Unknown',
                mintAddress: address,
                decimals: data.decimals || null,
                supply: data.supply || null,
                holderCount: data.holder || data.holderCount || null,
                verified: data.verified !== false, // Assume verified if not explicitly false
            }
        }

        return null
    } catch (error) {
        console.error('Solscan API error:', error)
        return null
    }
}

function calculateHealthScore(
    goPlusData: any,
    etherscanData: any,
): { score: number; explanations: string[] } {
    let score = 100
    const explanations: string[] = []

    if (goPlusData) {
        // Honeypot detection - major penalty
        if (goPlusData.is_honeypot === '1') {
            score -= 50
            explanations.push('Honeypot detected - tokens cannot be sold')
        }

        // Owner privileges - various penalties
        const ownerRisks: string[] = []
        if (goPlusData.owner_address && goPlusData.owner_address !== '0x0000000000000000000000000000000000000000') {
            if (goPlusData.can_take_back_ownership === '1') {
                score -= 15
                ownerRisks.push('Owner can take back ownership')
            }
            if (goPlusData.is_blacklisted === '1') {
                score -= 10
                ownerRisks.push('Blacklist function enabled')
            }
            if (goPlusData.is_whitelisted === '1') {
                score -= 5
                ownerRisks.push('Whitelist function enabled')
            }
            if (goPlusData.selfdestruct === '1') {
                score -= 20
                ownerRisks.push('Self-destruct function exists')
            }
            if (goPlusData.transfer_pausable === '1') {
                score -= 10
                ownerRisks.push('Transfers can be paused by owner')
            }
            if (goPlusData.is_mintable === '1') {
                score -= 15
                ownerRisks.push('Owner can mint new tokens')
            }
        }

        if (ownerRisks.length > 0) {
            explanations.push(...ownerRisks.slice(0, 3)) // Top 3 risks
        }

        // Liquidity checks
        if (goPlusData.lp_holder_count) {
            const lpCount = parseInt(goPlusData.lp_holder_count)
            if (lpCount === 0) {
                score -= 10
                explanations.push('No liquidity pool detected')
            } else if (lpCount === 1) {
                score -= 5
                explanations.push('Liquidity is not locked')
            } else {
                explanations.push('Liquidity pool has multiple holders')
            }
        }

        // Trading restrictions
        if (goPlusData.trading_cooldown && parseInt(goPlusData.trading_cooldown) > 0) {
            score -= 5
            explanations.push(`Trading cooldown of ${goPlusData.trading_cooldown} seconds`)
        }

        if (goPlusData.anti_whale_modifiable === '1') {
            score -= 5
            explanations.push('Anti-whale limits can be modified')
        }
    } else {
        score -= 10
        explanations.push('Unable to verify security data')
    }

    // Contract verification
    if (etherscanData) {
        explanations.push('Contract is verified on ' + etherscanData.chain)
    } else {
        score -= 10
        explanations.push('Contract verification status unknown')
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score))

    // Limit explanations to 3-5 most important
    const sortedExplanations = explanations.slice(0, 5)

    return { score, explanations: sortedExplanations }
}

function generateSolanaReport(
    address: string,
    solscanData: any,
    isPreBuyQuery: boolean = false,
): string {
    let report = '🩺 **TokenHealth Report**\n\n'
    
    // Token name and chain
    const tokenName = solscanData?.tokenName || solscanData?.tokenSymbol || 'Unknown'
    const chain = 'Solana'
    report += `**Token:** ${tokenName}\n`
    report += `**Chain:** ${chain}\n`
    report += `**Mint Address:** \`${address}\`\n\n`

    // For Solana, we use a simplified scoring system
    let score = 80 // Start with a neutral score for Solana
    const explanations: string[] = []

    if (solscanData) {
        if (solscanData.verified) {
            explanations.push('Token metadata is verified on Solscan')
        } else {
            score -= 10
            explanations.push('Token verification status unknown')
        }

        if (solscanData.holderCount) {
            const holderCount = typeof solscanData.holderCount === 'string' 
                ? parseInt(solscanData.holderCount) 
                : solscanData.holderCount
            if (holderCount > 100) {
                explanations.push('Token has a good holder distribution')
            } else if (holderCount > 10) {
                score -= 5
                explanations.push('Token has limited holder count')
            } else {
                score -= 10
                explanations.push('Token has very few holders')
            }
        } else {
            score -= 5
            explanations.push('Holder count not available')
        }
    } else {
        score -= 15
        explanations.push('Unable to fetch token data from Solscan')
    }

    // Determine risk level from score
    let riskLevel = 'LOW'
    let riskEmoji = '✅'
    if (score >= 80) {
        riskLevel = 'LOW'
        riskEmoji = '✅'
    } else if (score >= 50) {
        riskLevel = 'MEDIUM'
        riskEmoji = '⚠️'
    } else {
        riskLevel = 'HIGH'
        riskEmoji = '🚨'
    }

    // Health Score
    let scoreEmoji = '🟢'
    if (score < 50) scoreEmoji = '🔴'
    else if (score < 80) scoreEmoji = '🟡'
    
    report += `**Health Score:** ${score} / 100 ${scoreEmoji}\n`
    report += `**Risk Level:** ${riskEmoji} **${riskLevel}**\n\n`

    // Solana-specific fields
    report += `**Honeypot Risk:** ⚠️ Not available on Solana\n`
    report += `**Owner Privileges:** ⚠️ Not available on Solana\n`
    
    if (solscanData?.verified !== undefined) {
        report += `**Contract Verified:** ${solscanData.verified ? '✅ Yes' : '⚠️ Unknown'} (Solscan)\n`
    } else {
        report += `**Contract Verified:** ⚠️ Unable to verify\n`
    }

    report += `**Token Age:** ⏳ Check on Solscan\n`

    if (solscanData?.holderCount) {
        const holderCount = typeof solscanData.holderCount === 'string' 
            ? parseInt(solscanData.holderCount) 
            : solscanData.holderCount
        report += `**Holder Count:** ${holderCount.toLocaleString()}\n`
    } else {
        report += `**Holder Count:** ⚠️ Unable to determine\n`
    }

    report += `**Liquidity Status:** ⚠️ Not available on Solana\n`

    // Final Verdict
    report += `\n**Verdict:** `
    if (riskLevel === 'HIGH') {
        report += '🚨 **HIGH RISK** - Do not interact with this token'
    } else if (riskLevel === 'MEDIUM') {
        report += '⚠️ **USE CAUTION** - Review risks before interacting'
    } else {
        report += '✅ **SAFE** - Appears safe, but always DYOR'
    }

    // Explanation section
    report += `\n\n**Why this score?**\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No major risks detected\n`
        report += `• Token appears safe\n`
    }

    // Pre-buy warning if applicable
    if (isPreBuyQuery) {
        report += `\n**Recommendation:** `
        if (riskLevel === 'HIGH') {
            report += '🚨 **Strongly avoid. High risk of loss.**'
        } else if (riskLevel === 'MEDIUM') {
            report += '⚠️ **Use caution. There are some risks here.**'
        } else {
            report += '✅ **Looks relatively safe, but always do your own research.**'
        }
        report += `\n\n*This is not financial advice. Always do your own research.*`
    }

    return report
}

function generateHealthReport(
    address: string,
    goPlusData: any,
    etherscanData: any,
    isPreBuyQuery: boolean = false,
): string {
    let report = '🩺 **TokenHealth Report**\n\n'
    
    // Token name and chain
    const tokenName = etherscanData?.tokenName || goPlusData?.token_name || 'Unknown'
    const chain = etherscanData?.chain || 'Unknown'
    report += `**Token:** ${tokenName}\n`
    report += `**Chain:** ${chain}\n`
    report += `**Address:** \`${address}\`\n\n`

    // Calculate health score
    const { score, explanations } = calculateHealthScore(goPlusData, etherscanData)
    
    // Determine risk level from score
    let riskLevel = 'LOW'
    let riskEmoji = '✅'
    if (score >= 80) {
        riskLevel = 'LOW'
        riskEmoji = '✅'
    } else if (score >= 50) {
        riskLevel = 'MEDIUM'
        riskEmoji = '⚠️'
    } else {
        riskLevel = 'HIGH'
        riskEmoji = '🚨'
    }

    // Health Score (at top)
    let scoreEmoji = '🟢'
    if (score < 50) scoreEmoji = '🔴'
    else if (score < 80) scoreEmoji = '🟡'
    
    report += `**Health Score:** ${score} / 100 ${scoreEmoji}\n`
    report += `**Risk Level:** ${riskEmoji} **${riskLevel}**\n\n`

    // Risk Level Assessment (for detailed analysis)
    const warnings: string[] = []
    const risks: string[] = []

    if (goPlusData) {
        // Check honeypot risk
        if (goPlusData.is_honeypot === '1') {
            risks.push('Honeypot detected - tokens cannot be sold')
        }

        // Check owner privileges
        const ownerRisks: string[] = []
        if (goPlusData.owner_address && goPlusData.owner_address !== '0x0000000000000000000000000000000000000000') {
            if (goPlusData.can_take_back_ownership === '1') ownerRisks.push('Can take back ownership')
            if (goPlusData.is_blacklisted === '1') ownerRisks.push('Blacklist function enabled')
            if (goPlusData.is_whitelisted === '1') ownerRisks.push('Whitelist function enabled')
            if (goPlusData.selfdestruct === '1') ownerRisks.push('Self-destruct function')
            if (goPlusData.transfer_pausable === '1') ownerRisks.push('Transfer pausable')
            if (goPlusData.is_mintable === '1') ownerRisks.push('Mintable (unlimited supply risk)')
        }

        if (ownerRisks.length > 0) {
            risks.push(`Owner privileges: ${ownerRisks.join(', ')}`)
        }

        // Check liquidity
        if (goPlusData.lp_holder_count) {
            const lpCount = parseInt(goPlusData.lp_holder_count)
            if (lpCount === 0) {
                warnings.push('No liquidity pool detected')
            } else {
                report += `**Liquidity:** ${lpCount > 1 ? '✅ Multiple holders' : '⚠️ Single holder'}\n`
            }
        }

        // Check trading cooldown
        if (goPlusData.trading_cooldown && parseInt(goPlusData.trading_cooldown) > 0) {
            warnings.push(`Trading cooldown: ${goPlusData.trading_cooldown} seconds`)
        }

        // Check anti-whale mechanisms
        if (goPlusData.anti_whale_modifiable === '1') {
            warnings.push('Anti-whale limits can be modified by owner')
        }
    }

    // Honeypot Status
    if (goPlusData) {
        const honeypotStatus = goPlusData.is_honeypot === '1' ? '🚨 YES - High Risk' : '✅ No'
        report += `**Honeypot Risk:** ${honeypotStatus}\n`
    } else {
        report += `**Honeypot Risk:** ⚠️ Unable to verify\n`
    }

    // Owner Privileges
    if (risks.length > 0) {
        report += `**Owner Privileges:** ⚠️ ${risks[0]}\n`
    } else if (goPlusData) {
        report += `**Owner Privileges:** ✅ No dangerous functions detected\n`
    } else {
        report += `**Owner Privileges:** ⚠️ Unable to verify\n`
    }

    // Contract Verification
    if (etherscanData) {
        report += `**Contract Verified:** ✅ Yes (${etherscanData.chain})\n`
    } else {
        report += `**Contract Verified:** ⚠️ Unable to verify\n`
    }

    // Token Age (if we have creation data)
    if (etherscanData?.creationTx) {
        report += `**Token Age:** ⏳ Check on ${etherscanData.chain === 'Base' ? 'Basescan' : 'Etherscan'}\n`
    } else {
        report += `**Token Age:** ⚠️ Unable to determine\n`
    }

    // Holder Count (if available from GoPlus)
    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        report += `**Holder Count:** ${holderCount.toLocaleString()}\n`
    } else {
        report += `**Holder Count:** ⚠️ Unable to determine\n`
    }

    // Additional Warnings
    if (warnings.length > 0) {
        report += `\n**⚠️ Warnings:**\n`
        warnings.forEach(warning => {
            report += `• ${warning}\n`
        })
    }

    // Final Verdict
    report += `\n**Verdict:** `
    if (riskLevel === 'HIGH') {
        report += '🚨 **HIGH RISK** - Do not interact with this token'
    } else if (riskLevel === 'MEDIUM') {
        report += '⚠️ **USE CAUTION** - Review risks before interacting'
    } else {
        report += '✅ **SAFE** - Appears safe, but always DYOR'
    }

    // Explanation section
    report += `\n\n**Why this score?**\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No major risks detected\n`
        report += `• Contract appears safe\n`
    }

    // Pre-buy warning if applicable
    if (isPreBuyQuery) {
        report += `\n**Recommendation:** `
        if (riskLevel === 'HIGH') {
            report += '🚨 **Strongly avoid. High risk of loss.**'
        } else if (riskLevel === 'MEDIUM') {
            report += '⚠️ **Use caution. There are some risks here.**'
        } else {
            report += '✅ **Looks relatively safe, but always do your own research.**'
        }
        report += `\n\n*This is not financial advice. Always do your own research.*`
    }

    return report
}

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

bot.onSlashCommand('help', async (handler, { channelId }) => {
    await handler.sendMessage(
        channelId,
        '🩺 **TokenHealth — Smart Contract & Token Safety Scanner**\n\n' +
            'TokenHealth helps you quickly check if a token or contract looks safe before interacting with it.\n\n' +
            '**How to use:**\n\n' +
            '• **Slash command:**\n' +
            '`/health <token_or_contract_address>`\n\n' +
            '• **Or mention me naturally:**\n' +
            '"@TokenHealth is this token safe? <address>"\n' +
            '"@TokenHealth scan this contract <address>"\n' +
            '"@TokenHealth any red flags here? <address>"\n\n' +
            '**What I check:**\n\n' +
            '✅ Token name & chain\n' +
            '🚨 Risk level + health score\n' +
            '🍯 Honeypot behavior\n' +
            '🔑 Owner privileges (mint, pause, blacklist)\n' +
            '💧 Liquidity status (locked or not, if available)\n' +
            '📜 Contract verification\n' +
            '⏳ Token age\n' +
            '👥 Holder count (if available)\n\n' +
            '**❌ Disclaimer: This tool provides informational analysis only and does not promote speculation or gambling. ❌**\n\n' +
            '**Supported chains:**\n' +
            '- Ethereum / Base (via Etherscan / Basescan)\n' +
            '- Solana (via Solscan)\n\n' +
            '**Data sources:**\n' +
            '- GoPlus Security API\n' +
            '- Etherscan / Basescan\n' +
            '- Solscan\n\n' +
            '**Important:**\n' +
            'I never trade, never hold keys, and never sign transactions.\n' +
            'This is not financial advice — always do your own research.\n\n' +
            '*Built for safety. Built for Towns.*',
    )
})

// Helper function to detect natural language safety queries
function isSafetyQuery(message: string): boolean {
    const lowerMessage = message.toLowerCase()
    const triggers = [
        'is this token safe',
        'scan this contract',
        'any red flags',
        'should i buy',
        'explain this token',
        'check this token',
        'analyze this',
        'is this safe',
        'token safety',
        'contract safety',
        'is it safe',
        'thinking of aping',
        'is this a good buy',
        'should i invest',
    ]
    return triggers.some(trigger => lowerMessage.includes(trigger))
}

// Helper function to detect pre-buy queries
function isPreBuyQuery(message: string): boolean {
    const lowerMessage = message.toLowerCase()
    const preBuyTriggers = [
        'should i buy',
        'thinking of aping',
        'is this a good buy',
        'should i invest',
        'is it worth buying',
        'should i get',
    ]
    return preBuyTriggers.some(trigger => lowerMessage.includes(trigger))
}

// Helper function to extract address from message (EVM or Solana)
function extractAddress(message: string): { address: string; type: AddressType } | null {
    // Try EVM address first
    const evmMatch = message.match(/0x[a-fA-F0-9]{40}/)
    if (evmMatch && isAddress(evmMatch[0])) {
        return { address: evmMatch[0], type: 'evm' }
    }
    
    // Try Solana address (base58, 32-44 chars)
    const solanaPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g
    const matches = message.match(solanaPattern)
    if (matches) {
        for (const match of matches) {
            const addrType = detectAddressType(match)
            if (addrType === 'solana') {
                return { address: match, type: 'solana' }
            }
        }
    }
    
    return null
}

// Helper function to check if bot is explicitly mentioned
function isBotMentioned(message: string, botName: string = 'TokenHealth'): boolean {
    const lowerMessage = message.toLowerCase()
    const lowerBotName = botName.toLowerCase()
    // Check for @TokenHealth or just TokenHealth in mentions
    return lowerMessage.includes(`@${lowerBotName}`) || 
           lowerMessage.includes(`@${lowerBotName.toLowerCase()}`) ||
           (lowerMessage.includes(lowerBotName) && lowerMessage.includes('@'))
}

async function analyzeToken(
    handler: any,
    channelId: string,
    address: string,
    addressType: AddressType,
    isPreBuy: boolean = false,
): Promise<void> {
    try {
        // Send initial message
        await handler.sendMessage(channelId, '🔍 Analyzing token safety... This may take a moment.')

        if (addressType === 'solana') {
            // Solana token analysis
            const solscanData = await fetchSolscanData(address)
            const report = generateSolanaReport(address, solscanData, isPreBuy)
            await handler.sendMessage(channelId, report)
        } else {
            // EVM token analysis
            const [goPlusData, etherscanData] = await Promise.allSettled([
                fetchGoPlusData(address),
                fetchEtherscanData(address),
            ])

            const report = generateHealthReport(
                address,
                goPlusData.status === 'fulfilled' ? goPlusData.value : null,
                etherscanData.status === 'fulfilled' ? etherscanData.value : null,
                isPreBuy,
            )

            await handler.sendMessage(channelId, report)
        }
    } catch (error) {
        console.error('Error fetching token health:', error)
        await handler.sendMessage(
            channelId,
            '❌ Sorry, I encountered an error while analyzing the token. Please try again later.',
        )
    }
}

bot.onSlashCommand('health', async (handler, { channelId, args }) => {
    const address = args[0]?.trim()
    
    if (!address) {
        await handler.sendMessage(
            channelId,
            '❌ Please provide a token or contract address.\n\n**Usage:** `/health <address>`\n**Examples:**\n' +
            '• `/health 0x1234...5678` (Ethereum/Base)\n' +
            '• `/health <solana_address>` (Solana)',
        )
        return
    }

    // Detect address type
    const addressType = detectAddressType(address)
    
    if (addressType === 'invalid') {
        await handler.sendMessage(
            channelId,
            '❌ Invalid address format. Please provide a valid address:\n' +
            '• Ethereum/Base: `0x...` (42 characters)\n' +
            '• Solana: Base58 address (32-44 characters)',
        )
        return
    }

    await analyzeToken(handler, channelId, address, addressType, false)
})

bot.onMessage(async (handler, { message, channelId, isMentioned }) => {
    // Only respond to direct mentions AND explicit @TokenHealth mentions
    if (!isMentioned) {
        return
    }

    // Check if bot is explicitly mentioned by name
    if (!isBotMentioned(message)) {
        return
    }

    // Extract address from message
    const addressData = extractAddress(message)
    
    // Check if it's a pre-buy query
    const isPreBuy = isPreBuyQuery(message)

    if (addressData && addressData.address) {
        // Address found - analyze it
        await analyzeToken(handler, channelId, addressData.address, addressData.type, isPreBuy)
        return
    }

    // No address found - ask for one
    await handler.sendMessage(
        channelId,
        'Please include a valid token or contract address so I can scan it.\n\n' +
            '**Examples:**\n' +
            '• "@TokenHealth is this token safe? 0x1234...5678"\n' +
            '• "@TokenHealth scan this contract <address>"',
    )
})

bot.onReaction(async (handler, { reaction, channelId }) => {
    if (reaction === '👋') {
        await handler.sendMessage(channelId, 'I saw your wave! 👋')
    }
})

const app = bot.start()

// Bot discovery endpoint
app.get('/.well-known/agent-metadata.json', async (c) => {
    return c.json(await bot.getIdentityMetadata())
})

export default app
