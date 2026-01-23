import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands.js'
import { isAddress } from 'viem'

// Chain IDs for GoPlus API
const CHAIN_IDS = {
    ETHEREUM: '1',
    BASE: '8453',
    ARBITRUM: '42161',
    BSC: '56',
}

// Address type detection with strict validation
function detectAddressType(address) {
    // EVM: starts with 0x and length = 42
    if (address.startsWith('0x') && address.length === 42 && isAddress(address)) {
        return 'evm'
    }
    
    // Solana: base58, 32-44 characters, not hex
    const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    if (solanaPattern.test(address) && !address.match(/^[0-9a-fA-F]+$/)) {
        return 'solana'
    }
    
    return 'invalid'
}

// Detect EVM chain by trying GoPlus API for each supported chain
async function detectEVMChain(address) {
    const chains = [
        { id: CHAIN_IDS.ETHEREUM, name: 'Ethereum' },
        { id: CHAIN_IDS.BASE, name: 'Base' },
        { id: CHAIN_IDS.ARBITRUM, name: 'Arbitrum' },
        { id: CHAIN_IDS.BSC, name: 'BSC' },
    ]
    
    // Try each chain in order
    for (const chain of chains) {
        try {
            const response = await fetch(
                `https://api.gopluslabs.io/api/v1/token_security/${chain.id}?contract_addresses=${address}`,
                {
                    headers: { 'Accept': 'application/json' },
                },
            )
            
            if (response.ok) {
                const data = await response.json()
                if (data.result && data.result[address.toLowerCase()]) {
                    return { chainId: chain.id, chainName: chain.name }
                }
            }
        } catch (error) {
            // Continue to next chain
            continue
        }
    }
    
    return null
}

// Fetch GoPlus data for specific chain
async function fetchGoPlusData(address, chainId) {
    try {
        const response = await fetch(
            `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
            {
                headers: { 'Accept': 'application/json' },
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

// Fetch explorer data for specific chain
async function fetchExplorerData(address, chainName) {
    try {
        let apiKey, baseUrl, explorerName
        
        switch (chainName) {
            case 'Ethereum':
                apiKey = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken'
                baseUrl = 'https://api.etherscan.io'
                explorerName = 'Etherscan'
                break
            case 'Base':
                apiKey = process.env.BASESCAN_API_KEY || 'YourApiKeyToken'
                baseUrl = 'https://api.basescan.org'
                explorerName = 'Basescan'
                break
            case 'Arbitrum':
                apiKey = process.env.ARBISCAN_API_KEY || 'YourApiKeyToken'
                baseUrl = 'https://api.arbiscan.io'
                explorerName = 'Arbiscan'
                break
            case 'BSC':
                apiKey = process.env.BSCSCAN_API_KEY || 'YourApiKeyToken'
                baseUrl = 'https://api.bscscan.com'
                explorerName = 'BscScan'
                break
            default:
                return null
        }
        
        const [creationResponse, tokenResponse] = await Promise.all([
            fetch(`${baseUrl}/api?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${apiKey}`),
            fetch(`${baseUrl}/api?module=token&action=tokeninfo&contractaddress=${address}&apikey=${apiKey}`),
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
                    chain: chainName,
                    creationTx: creationData.result[0].txHash,
                    creator: creationData.result[0].contractCreator,
                    source: explorerName.toLowerCase(),
                    tokenName,
                }
            }
        }

        return null
    } catch (error) {
        console.error('Explorer API error:', error)
        return null
    }
}

// Fetch Solscan data
async function fetchSolscanData(address) {
    try {
        const response = await fetch(
            `https://api.solscan.io/token/meta?token=${address}`,
            {
                headers: { 'Accept': 'application/json' },
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
                verified: data.verified !== false,
            }
        }

        return null
    } catch (error) {
        console.error('Solscan API error:', error)
        return null
    }
}

// Calculate health score with strict rules
function calculateHealthScore(goPlusData, explorerData, chainDetected) {
    let score = 100
    const explanations = []
    let hasHighRisk = false
    let hasHoneypot = false
    let hasDangerousPrivileges = false
    let missingFields = 0

    // Check if we have critical data
    if (!goPlusData) missingFields++
    if (!explorerData) missingFields++
    if (!chainDetected) missingFields++

    if (goPlusData) {
        // HIGH RISK: Honeypot
        if (goPlusData.is_honeypot === '1') {
            score = Math.min(score, 30)
            hasHoneypot = true
            hasHighRisk = true
            explanations.push('Honeypot detected - tokens cannot be sold')
        }

        // HIGH RISK: Dangerous owner privileges
        const ownerRisks = []
        if (goPlusData.owner_address && goPlusData.owner_address !== '0x0000000000000000000000000000000000000000') {
            if (goPlusData.can_take_back_ownership === '1') {
                ownerRisks.push('Owner can take back ownership')
                hasDangerousPrivileges = true
            }
            if (goPlusData.is_blacklisted === '1') {
                ownerRisks.push('Blacklist function enabled')
                hasDangerousPrivileges = true
            }
            if (goPlusData.selfdestruct === '1') {
                ownerRisks.push('Self-destruct function exists')
                hasDangerousPrivileges = true
            }
            if (goPlusData.is_mintable === '1') {
                ownerRisks.push('Owner can mint new tokens')
                hasDangerousPrivileges = true
            }
            if (goPlusData.transfer_pausable === '1') {
                ownerRisks.push('Transfers can be paused by owner')
                hasDangerousPrivileges = true
            }
        }

        if (hasDangerousPrivileges) {
            score = Math.min(score, 40)
            hasHighRisk = true
            explanations.push(...ownerRisks.slice(0, 3))
        }

        // Liquidity checks
        if (goPlusData.lp_holder_count !== undefined) {
            const lpCount = parseInt(goPlusData.lp_holder_count) || 0
            if (lpCount === 0) {
                score -= 20
                explanations.push('No liquidity pool detected')
            } else if (lpCount === 1) {
                score -= 20
                explanations.push('Liquidity is not locked (single holder)')
            }
        } else {
            missingFields++
        }
    }

    // Contract verification
    if (explorerData) {
        explanations.push(`Contract is verified on ${explorerData.chain}`)
    } else {
        score -= 10
        missingFields++
        explanations.push('Contract verification status unknown')
    }

    // Missing critical fields penalty
    if (missingFields >= 2) {
        score = Math.min(score, 70)
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score))

    // Determine risk level
    let riskLevel = 'LOW'
    let riskEmoji = '✅'
    
    if (hasHighRisk || score <= 49) {
        riskLevel = 'HIGH'
        riskEmoji = '🚨'
    } else if (score <= 79 || missingFields >= 2) {
        riskLevel = 'MEDIUM'
        riskEmoji = '⚠️'
    } else {
        // Only LOW if ALL conditions met
        if (!chainDetected || !goPlusData || !explorerData || hasHoneypot || hasDangerousPrivileges || missingFields > 0) {
            riskLevel = 'MEDIUM'
            riskEmoji = '⚠️'
            score = Math.min(score, 79)
        }
    }

    return { score, riskLevel, riskEmoji, explanations: explanations.slice(0, 5) }
}

// Generate Solana report (ALWAYS MEDIUM risk, score ≤70)
function generateSolanaReport(address, solscanData, isPreBuyQuery = false) {
    let report = '🩺 **TokenHealth Report**\n\n'
    
    const tokenName = solscanData?.tokenName || solscanData?.tokenSymbol || 'Unknown'
    const chain = 'Solana'
    report += `**Token:** ${tokenName}\n`
    report += `**Chain:** ${chain}\n`
    report += `**Address:** \`${address}\`\n\n`

    // Solana ALWAYS has score ≤70 and MEDIUM risk
    let score = 70
    const explanations = []

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

    // Ensure score never exceeds 70 for Solana
    score = Math.min(score, 70)

    // Health Score
    const scoreEmoji = '🟡'
    report += `**Health Score:** ${score} / 100 ${scoreEmoji}\n`
    report += `**Risk Level:** ⚠️ **MEDIUM**\n\n`

    // Solana-specific fields (always show limitations)
    report += `**Honeypot Risk:** ⚠️ Not supported on Solana\n`
    report += `**Owner Privileges:** ⚠️ Not supported on Solana\n`
    
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

    report += `**Liquidity Status:** ⚠️ Not supported on Solana\n`

    // Final Verdict (ALWAYS LIMITED ANALYSIS for Solana)
    report += `\n**Verdict:** ⚠️ **LIMITED ANALYSIS** – Solana security checks are limited. Review on Solscan before interacting.\n`

    // Explanation section
    report += `\n**Why this score?**\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    }
    report += `• Solana security analysis is limited compared to EVM chains\n`

    // Pre-buy warning if applicable
    if (isPreBuyQuery) {
        report += `\n**Recommendation:** ⚠️ **Use caution. There are some risks here.**\n\n*This is not financial advice. Always do your own research.*`
    }

    return report
}

// Generate EVM health report
function generateHealthReport(address, goPlusData, explorerData, chainDetected, isPreBuyQuery = false) {
    let report = '🩺 **TokenHealth Report**\n\n'
    
    const tokenName = explorerData?.tokenName || goPlusData?.token_name || 'Unknown'
    const chain = explorerData?.chain || (chainDetected ? 'Unknown EVM' : 'Unsupported / Unknown')
    report += `**Token:** ${tokenName}\n`
    report += `**Chain:** ${chain}\n`
    report += `**Address:** \`${address}\`\n\n`

    // Calculate health score
    const { score, riskLevel, riskEmoji, explanations } = calculateHealthScore(goPlusData, explorerData, chainDetected)
    
    // Health Score
    let scoreEmoji = '🟢'
    if (score < 50) scoreEmoji = '🔴'
    else if (score < 80) scoreEmoji = '🟡'
    
    report += `**Health Score:** ${score} / 100 ${scoreEmoji}\n`
    report += `**Risk Level:** ${riskEmoji} **${riskLevel}**\n\n`

    // Fields
    // Honeypot Risk
    if (goPlusData) {
        const honeypotStatus = goPlusData.is_honeypot === '1' ? '🚨 YES - High Risk' : '✅ No'
        report += `**Honeypot Risk:** ${honeypotStatus}\n`
    } else {
        report += `**Honeypot Risk:** ⚠️ Unable to verify\n`
    }

    // Owner Privileges
    if (goPlusData) {
        const ownerRisks = []
        if (goPlusData.owner_address && goPlusData.owner_address !== '0x0000000000000000000000000000000000000000') {
            if (goPlusData.can_take_back_ownership === '1') ownerRisks.push('Can take back ownership')
            if (goPlusData.is_blacklisted === '1') ownerRisks.push('Blacklist function')
            if (goPlusData.is_whitelisted === '1') ownerRisks.push('Whitelist function')
            if (goPlusData.selfdestruct === '1') ownerRisks.push('Self-destruct')
            if (goPlusData.transfer_pausable === '1') ownerRisks.push('Transfer pausable')
            if (goPlusData.is_mintable === '1') ownerRisks.push('Mintable')
        }
        
        if (ownerRisks.length > 0) {
            report += `**Owner Privileges:** ⚠️ ${ownerRisks.slice(0, 3).join(', ')}\n`
        } else {
            report += `**Owner Privileges:** ✅ No dangerous functions detected\n`
        }
    } else {
        report += `**Owner Privileges:** ⚠️ Unable to verify\n`
    }

    // Liquidity Status
    if (goPlusData?.lp_holder_count !== undefined) {
        const lpCount = parseInt(goPlusData.lp_holder_count) || 0
        if (lpCount === 0) {
            report += `**Liquidity Status:** ⚠️ No liquidity pool detected\n`
        } else if (lpCount === 1) {
            report += `**Liquidity Status:** ⚠️ Unlocked (single holder)\n`
        } else {
            report += `**Liquidity Status:** ✅ Multiple holders\n`
        }
    } else {
        report += `**Liquidity Status:** ⚠️ Unable to verify\n`
    }

    // Contract Verified
    if (explorerData) {
        report += `**Contract Verified:** ✅ Yes (${explorerData.chain})\n`
    } else {
        report += `**Contract Verified:** ⚠️ Unable to verify\n`
    }

    // Token Age
    if (explorerData?.creationTx) {
        report += `**Token Age:** ⏳ Check on ${explorerData.source === 'basescan' ? 'Basescan' : explorerData.source === 'arbiscan' ? 'Arbiscan' : explorerData.source === 'bscscan' ? 'BscScan' : 'Etherscan'}\n`
    } else {
        report += `**Token Age:** ⚠️ Unable to determine\n`
    }

    // Holder Count
    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        report += `**Holder Count:** ${holderCount.toLocaleString()}\n`
    } else {
        report += `**Holder Count:** ⚠️ Unable to determine\n`
    }

    // Final Verdict
    report += `\n**Verdict:** `
    
    if (!chainDetected) {
        report += '⚠️ **INSUFFICIENT DATA** – Unable to identify chain. Proceed with caution.'
    } else if (riskLevel === 'HIGH') {
        report += '🚨 **HIGH RISK** – Serious security issues detected.'
    } else if (riskLevel === 'MEDIUM') {
        if (!goPlusData || !explorerData) {
            report += '⚠️ **DATA UNAVAILABLE** – Unable to fetch security data. Try again later.'
        } else {
            report += '⚠️ **USE CAUTION** – Review risks before interacting.'
        }
    } else {
        // Only LOW if ALL conditions met
        if (chainDetected && goPlusData && explorerData && 
            goPlusData.is_honeypot !== '1' && 
            (!goPlusData.owner_address || goPlusData.owner_address === '0x0000000000000000000000000000000000000000' ||
             (goPlusData.can_take_back_ownership !== '1' && goPlusData.is_blacklisted !== '1' && 
              goPlusData.selfdestruct !== '1' && goPlusData.is_mintable !== '1' && 
              goPlusData.transfer_pausable !== '1'))) {
            report += '✅ **SAFE** – No major risks detected, but always DYOR.'
        } else {
            report += '⚠️ **USE CAUTION** – Review risks before interacting.'
        }
    }

    // Explanation section
    report += `\n\n**Why this score?**\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No major risks detected\n`
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

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA, process.env.JWT_SECRET, {
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
            '**Supported chains:**\n' +
            '- **EVM:** Ethereum, Base, Arbitrum, BSC\n' +
            '- **Solana:** Limited analysis (always shows MEDIUM risk)\n\n' +
            '**Data sources:**\n' +
            '- GoPlus Security API\n' +
            '- Etherscan / Basescan / Arbiscan / BscScan\n' +
            '- Solscan (Solana)\n\n' +
            '**Important:**\n' +
            '- This bot is **read-only** and **non-custodial**\n' +
            '- Results are **informational only**, not financial advice\n' +
            '- Always do your own research (DYOR)',
    )
})

// Helper function to detect natural language safety queries
function isSafetyQuery(message) {
    const lowerMessage = message.toLowerCase()
    const triggers = [
        'is this token safe',
        'check this contract',
        'scan this address',
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
function isPreBuyQuery(message) {
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
function extractAddress(message) {
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
function isBotMentioned(message, botName = 'TokenHealth') {
    const lowerMessage = message.toLowerCase()
    const lowerBotName = botName.toLowerCase()
    return lowerMessage.includes(`@${lowerBotName}`) || 
           lowerMessage.includes(`@${lowerBotName.toLowerCase()}`) ||
           (lowerMessage.includes(lowerBotName) && lowerMessage.includes('@'))
}

async function analyzeToken(handler, channelId, address, addressType, isPreBuy = false) {
    try {
        // Send initial message
        await handler.sendMessage(channelId, '🔍 Analyzing token safety... This may take a moment.')

        if (addressType === 'solana') {
            // Solana token analysis
            const solscanData = await fetchSolscanData(address)
            const report = generateSolanaReport(address, solscanData, isPreBuy)
            await handler.sendMessage(channelId, report)
        } else if (addressType === 'evm') {
            // EVM token analysis - detect chain first
            const chainInfo = await detectEVMChain(address)
            
            if (!chainInfo) {
                // Chain not detected - return INSUFFICIENT DATA report
                const report = generateHealthReport(address, null, null, false, isPreBuy)
                await handler.sendMessage(channelId, report)
                return
            }
            
            // Fetch data for detected chain
            const [goPlusData, explorerData] = await Promise.allSettled([
                fetchGoPlusData(address, chainInfo.chainId),
                fetchExplorerData(address, chainInfo.chainName),
            ])

            const report = generateHealthReport(
                address,
                goPlusData.status === 'fulfilled' ? goPlusData.value : null,
                explorerData.status === 'fulfilled' ? explorerData.value : null,
                true, // chainDetected
                isPreBuy,
            )

            await handler.sendMessage(channelId, report)
        } else {
            // Invalid address type
            await handler.sendMessage(
                channelId,
                '❌ Invalid address format. Please provide a valid address:\n' +
                '• Ethereum/Base/Arbitrum/BSC: `0x...` (42 characters)\n' +
                '• Solana: Base58 address (32-44 characters)',
            )
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
            '• `/health 0x1234...5678` (Ethereum/Base/Arbitrum/BSC)\n' +
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
            '• Ethereum/Base/Arbitrum/BSC: `0x...` (42 characters)\n' +
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

    // Check if it's a safety query without address
    if (isSafetyQuery(message)) {
        await handler.sendMessage(
            channelId,
            'Please include a valid token or contract address so I can scan it.\n\n' +
                '**Examples:**\n' +
                '• "@TokenHealth is this token safe? 0x1234...5678"\n' +
                '• "@TokenHealth scan this contract <address>"',
        )
        return
    }

    // Generic mention response
    await handler.sendMessage(
        channelId,
        'Hi! I\'m TokenHealth, your token safety scanner. Use `/health <address>` or mention me with an address to scan a token.\n\n' +
            '**Examples:**\n' +
            '• `/health 0x1234...5678`\n' +
            '• "@TokenHealth is this token safe? 0x1234...5678"',
    )
})

bot.onReaction(async (handler, { reaction, channelId }) => {
    if (reaction === '👋') {
        await handler.sendMessage(channelId, 'I saw your wave! 👋')
    }
})

// CRITICAL: Export the app returned by bot.start()
// This allows Bun/Render to automatically serve the app and handle webhooks correctly
// bot.start() automatically sets up the /webhook endpoint for Towns Protocol
const app = bot.start()

// Health check endpoint for Render and Towns verification
// Handle GET and HEAD for root path - POST requests go to /webhook (handled by bot.start())
app.get('/', async (c) => {
    // Hono automatically handles HEAD requests for GET routes
    if (c.req.method === 'HEAD') {
        return c.text('', 200)
    }
    return c.json({ status: 'ok', service: 'TokenHealth Bot' })
})

// Bot discovery endpoint
app.get('/.well-known/agent-metadata.json', async (c) => {
    return c.json(await bot.getIdentityMetadata())
})

// Verify webhook endpoint exists (bot.start() should set this up automatically)
// Add a test endpoint to verify routing works
app.get('/health', async (c) => {
    return c.json({ 
        status: 'ok', 
        service: 'TokenHealth Bot',
        endpoints: {
            webhook: '/webhook',
            discovery: '/.well-known/agent-metadata.json',
            health: '/health'
        }
    })
})

// NOTE: Do NOT add any routes for /webhook - bot.start() handles it automatically
// Adding routes here would interfere with Towns Protocol's webhook handling

// Export the app as default so Bun/Render can automatically serve it
// This is required for webhook POST requests to work correctly
// When Bun sees `export default app`, it automatically serves the Hono app
export default app
