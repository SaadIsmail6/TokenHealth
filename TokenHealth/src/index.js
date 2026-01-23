import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands.js'
import { isAddress } from 'viem'

// Well-known tokens whitelist
const WELL_KNOWN_TOKENS = {
    '0xc02aa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Ethereum' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', chain: 'Ethereum' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', chain: 'Ethereum' },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped BTC', symbol: 'WBTC', chain: 'Ethereum' },
    // Add Towns token when official contract is known
}

// Chain IDs for GoPlus API
const CHAIN_IDS = {
    ETHEREUM: '1',
    BASE: '8453',
    ARBITRUM: '42161',
    BSC: '56',
}

// Check if input is a ticker symbol (reject these)
function isTickerSymbol(input) {
    const trimmed = input.trim()
    // Ticker symbols typically start with $ or are short uppercase strings
    if (trimmed.startsWith('$')) return true
    if (/^[A-Z]{2,10}$/.test(trimmed) && !trimmed.startsWith('0x') && trimmed.length < 10) return true
    return false
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
    // Check well-known tokens first
    const lowerAddress = address.toLowerCase()
    if (WELL_KNOWN_TOKENS[lowerAddress]) {
        const token = WELL_KNOWN_TOKENS[lowerAddress]
        return { chainId: CHAIN_IDS.ETHEREUM, chainName: token.chain || 'Ethereum' }
    }
    
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
    
    // Default to Ethereum if address format is valid
    if (address.startsWith('0x') && address.length === 42) {
        return { chainId: CHAIN_IDS.ETHEREUM, chainName: 'Ethereum' }
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

// Fetch Dexscreener data for liquidity and holders
async function fetchDexscreenerData(address, chainName) {
    try {
        // Map chain names to Dexscreener chain identifiers
        const chainMap = {
            'Ethereum': 'ethereum',
            'Base': 'base',
            'Arbitrum': 'arbitrum',
            'BSC': 'bsc',
        }
        
        const chainId = chainMap[chainName] || 'ethereum'
        const response = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${address}`,
            {
                headers: { 'Accept': 'application/json' },
            },
        )

        if (!response.ok) {
            throw new Error(`Dexscreener API error: ${response.status}`)
        }

        const data = await response.json()
        
        if (data.pairs && data.pairs.length > 0) {
            // Find the pair with highest liquidity
            const sortedPairs = data.pairs
                .filter(p => p.chainId === chainId)
                .sort((a, b) => (parseFloat(b.liquidity?.usd || 0)) - (parseFloat(a.liquidity?.usd || 0)))
            
            if (sortedPairs.length > 0) {
                const topPair = sortedPairs[0]
                return {
                    liquidityUsd: parseFloat(topPair.liquidity?.usd || 0),
                    volume24h: parseFloat(topPair.volume?.h24 || 0),
                    priceChange24h: parseFloat(topPair.priceChange?.h24 || 0),
                    fdv: parseFloat(topPair.fdv || 0),
                    pairCount: sortedPairs.length,
                }
            }
        }

        return null
    } catch (error) {
        console.error('Dexscreener API error:', error)
        return null
    }
}

// Fetch explorer data for specific chain with enhanced metadata
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
        
        // Fetch multiple data points in parallel
        const [creationResponse, tokenResponse, contractResponse] = await Promise.all([
            fetch(`${baseUrl}/api?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${apiKey}`),
            fetch(`${baseUrl}/api?module=token&action=tokeninfo&contractaddress=${address}&apikey=${apiKey}`),
            fetch(`${baseUrl}/api?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`),
        ])

        let tokenName = null
        let tokenSymbol = null
        let verified = false
        let creationTx = null
        let creator = null
        
        // Check well-known tokens
        const lowerAddress = address.toLowerCase()
        if (WELL_KNOWN_TOKENS[lowerAddress]) {
            const token = WELL_KNOWN_TOKENS[lowerAddress]
            tokenName = token.name
            tokenSymbol = token.symbol
            verified = true
        }
        
        // Parse token info
        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json()
            if (tokenData.status === '1' && tokenData.result?.[0]) {
                tokenName = tokenName || tokenData.result[0].tokenName || null
                tokenSymbol = tokenSymbol || tokenData.result[0].symbol || null
            }
        }
        
        // Parse contract creation
        if (creationResponse.ok) {
            const creationData = await creationResponse.json()
            if (creationData.status === '1' && creationData.result?.[0]) {
                creationTx = creationData.result[0].txHash
                creator = creationData.result[0].contractCreator
            }
        }
        
        // Parse contract verification status
        if (contractResponse.ok) {
            const contractData = await contractResponse.json()
            if (contractData.status === '1' && contractData.result?.[0]) {
                // Contract is verified if source code exists and is not empty
                verified = verified || (contractData.result[0].SourceCode && contractData.result[0].SourceCode.trim() !== '')
            }
        }
        
        if (tokenName || creationTx || verified) {
            return {
                chain: chainName,
                creationTx,
                creator,
                source: explorerName.toLowerCase(),
                tokenName: tokenName || 'Unknown',
                tokenSymbol: tokenSymbol || null,
                verified,
            }
        }

        return null
    } catch (error) {
        console.error('Explorer API error:', error)
        return null
    }
}

// Fetch Solscan data with enhanced metadata
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
                mintAuthority: data.mintAuthority || null,
                freezeAuthority: data.freezeAuthority || null,
            }
        }

        return null
    } catch (error) {
        console.error('Solscan API error:', error)
        return null
    }
}

// Calculate health score with improved logic
function calculateHealthScore(goPlusData, explorerData, dexscreenerData, chainDetected) {
    let score = 100
    const explanations = []
    let hasHighRisk = false
    let hasHoneypot = false
    let hasDangerousPrivileges = false

    if (goPlusData) {
        // HIGH RISK: Honeypot
        if (goPlusData.is_honeypot === '1') {
            score = 20
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
            if (goPlusData.trading_cooldown && parseInt(goPlusData.trading_cooldown) > 0) {
                ownerRisks.push('Trading cooldown restrictions')
                hasDangerousPrivileges = true
            }
        }

        if (hasDangerousPrivileges && !hasHoneypot) {
            score = Math.min(score, 40)
            hasHighRisk = true
            explanations.push(...ownerRisks.slice(0, 3))
        }

        // Liquidity checks
        if (dexscreenerData) {
            if (dexscreenerData.liquidityUsd < 10000) {
                score -= 15
                explanations.push('Low liquidity detected')
            } else if (dexscreenerData.liquidityUsd > 100000) {
                explanations.push('Good liquidity available')
            }
        } else if (goPlusData.lp_holder_count !== undefined) {
            const lpCount = parseInt(goPlusData.lp_holder_count) || 0
            if (lpCount === 0) {
                score -= 20
                explanations.push('No liquidity pool detected')
            } else if (lpCount === 1) {
                score -= 20
                explanations.push('Liquidity is not locked (single holder)')
            }
        }
    }

    // Contract verification
    if (explorerData?.verified) {
        explanations.push(`Contract is verified on ${explorerData.chain}`)
    } else {
        score -= 10
        explanations.push('Contract verification status unknown')
    }

    // Token age (if we have creation data, assume older = safer)
    if (explorerData?.creationTx) {
        explanations.push('Token creation transaction available')
    } else {
        score -= 5
    }

    // Holder count
    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        if (holderCount > 1000) {
            explanations.push('Good holder distribution')
        } else if (holderCount < 100) {
            score -= 10
            explanations.push('Limited holder count')
        }
    }

    // Ensure score is within bounds
    score = Math.max(0, Math.min(95, score)) // Never 100% safe

    // Determine risk level
    let riskLevel = 'LOW'
    let riskEmoji = '✅'
    
    if (hasHighRisk || score <= 40) {
        riskLevel = 'HIGH'
        riskEmoji = '🚨'
    } else if (score <= 79) {
        riskLevel = 'MEDIUM'
        riskEmoji = '⚠️'
    } else {
        // Only LOW if ALL conditions met
        if (!chainDetected || !goPlusData || !explorerData || hasHoneypot || hasDangerousPrivileges) {
            riskLevel = 'MEDIUM'
            riskEmoji = '⚠️'
            score = Math.min(score, 79)
        }
    }

    return { score, riskLevel, riskEmoji, explanations: explanations.slice(0, 5) }
}

// Generate Solana report
function generateSolanaReport(address, solscanData, isPreBuyQuery = false) {
    let report = '🩺 TokenHealth Report\n\n'
    
    const tokenName = solscanData?.tokenName || 'Unknown'
    const tokenSymbol = solscanData?.tokenSymbol || ''
    const chain = 'Solana'
    
    report += `Token: ${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}\n`
    report += `Chain: ${chain}\n`
    report += `Address: ${address}\n\n`

    // Solana scoring
    let score = 70
    const explanations = []

    if (solscanData) {
        if (solscanData.verified) {
            explanations.push('Token metadata is verified on Solscan')
        } else {
            score -= 10
            explanations.push('Token verification status unknown')
        }

        if (solscanData.mintAuthority) {
            score -= 15
            explanations.push('Mint authority is active')
        }

        if (solscanData.freezeAuthority) {
            score -= 10
            explanations.push('Freeze authority is active')
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
    report += `Health Score: ${score} / 100\n`
    report += `Risk Level: MEDIUM\n\n`

    // Fields
    report += `Honeypot Risk: ⚠️ Not supported on Solana\n`
    
    if (solscanData?.mintAuthority || solscanData?.freezeAuthority) {
        report += `Owner Privileges: ⚠️ Mint/Freeze authority active\n`
    } else {
        report += `Owner Privileges: ✅ No active authorities\n`
    }
    
    if (solscanData?.verified) {
        report += `Contract Verified: ✅ Yes (Solscan)\n`
    } else {
        report += `Contract Verified: ⚠️ Unknown\n`
    }

    report += `Token Age: ⏳ Check on Solscan\n`

    if (solscanData?.holderCount) {
        const holderCount = typeof solscanData.holderCount === 'string' 
            ? parseInt(solscanData.holderCount) 
            : solscanData.holderCount
        report += `Holder Count: ${holderCount.toLocaleString()}\n`
    } else {
        report += `Holder Count: ⚠️ Unable to determine\n`
    }

    report += `Liquidity Status: ⚠️ Not supported on Solana\n`

    // Final Verdict
    report += `\nFinal Verdict: ⚠️ LIMITED ANALYSIS – Solana security checks are limited. Review on Solscan before interacting.\n`

    // Explanation section
    report += `\nWhy this score?\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    }
    report += `• Solana security analysis is limited compared to EVM chains\n`

    // Disclaimer
    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.`

    // Pre-buy warning if applicable
    if (isPreBuyQuery) {
        report += `\n\nRecommendation: ⚠️ Use caution. There are some risks here.`
    }

    return report
}

// Generate EVM health report with exact format
function generateHealthReport(address, goPlusData, explorerData, dexscreenerData, chainDetected, isPreBuyQuery = false) {
    let report = '🩺 TokenHealth Report\n\n'
    
    // Check well-known tokens
    const lowerAddress = address.toLowerCase()
    const wellKnown = WELL_KNOWN_TOKENS[lowerAddress]
    
    const tokenName = wellKnown?.name || explorerData?.tokenName || goPlusData?.token_name || 'Unknown'
    const tokenSymbol = wellKnown?.symbol || explorerData?.tokenSymbol || goPlusData?.token_symbol || ''
    const chain = wellKnown?.chain || explorerData?.chain || (chainDetected ? 'Ethereum' : 'Unknown')
    
    report += `Token: ${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}\n`
    report += `Chain: ${chain}\n`
    report += `Address: ${address}\n\n`

    // Calculate health score
    const { score, riskLevel, riskEmoji, explanations } = calculateHealthScore(goPlusData, explorerData, dexscreenerData, chainDetected)
    
    // Health Score
    report += `Health Score: ${score} / 100\n`
    report += `Risk Level: ${riskLevel}\n\n`

    // Fields with exact format
    // Honeypot Risk
    if (goPlusData) {
        if (goPlusData.is_honeypot === '1') {
            report += `Honeypot Risk: ❌\n`
        } else {
            report += `Honeypot Risk: ✅\n`
        }
    } else {
        report += `Honeypot Risk: ⚠️\n`
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
            if (goPlusData.trading_cooldown && parseInt(goPlusData.trading_cooldown) > 0) ownerRisks.push('Trading cooldown')
        }
        
        if (ownerRisks.length > 0) {
            report += `Owner Privileges: ⚠️\n`
        } else {
            report += `Owner Privileges: ✅\n`
        }
    } else {
        report += `Owner Privileges: ⚠️\n`
    }

    // Liquidity Status
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd > 100000) {
            report += `Liquidity Status: ✅\n`
        } else if (dexscreenerData.liquidityUsd > 10000) {
            report += `Liquidity Status: ⚠️\n`
        } else {
            report += `Liquidity Status: ❌\n`
        }
    } else if (goPlusData?.lp_holder_count !== undefined) {
        const lpCount = parseInt(goPlusData.lp_holder_count) || 0
        if (lpCount > 1) {
            report += `Liquidity Status: ✅\n`
        } else if (lpCount === 1) {
            report += `Liquidity Status: ⚠️\n`
        } else {
            report += `Liquidity Status: ❌\n`
        }
    } else {
        report += `Liquidity Status: ⚠️\n`
    }

    // Contract Verified
    if (explorerData?.verified || wellKnown) {
        report += `Contract Verified: ✅\n`
    } else {
        report += `Contract Verified: ⚠️\n`
    }

    // Token Age
    if (explorerData?.creationTx) {
        report += `Token Age: ⏳ Check on ${explorerData.source === 'basescan' ? 'Basescan' : explorerData.source === 'arbiscan' ? 'Arbiscan' : explorerData.source === 'bscscan' ? 'BscScan' : 'Etherscan'}\n`
    } else {
        report += `Token Age: ⚠️ Unable to determine\n`
    }

    // Holder Count
    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        report += `Holder Count: ${holderCount.toLocaleString()}\n`
    } else {
        report += `Holder Count: ⚠️ Unable to determine\n`
    }

    // Final Verdict
    report += `\nFinal Verdict: `
    
    if (!chainDetected && !wellKnown) {
        report += '⚠️ INSUFFICIENT DATA – Unable to identify chain. Proceed with caution.'
    } else if (riskLevel === 'HIGH') {
        report += '🚨 HIGH RISK – Serious security issues detected.'
    } else if (riskLevel === 'MEDIUM') {
        if (!goPlusData || !explorerData) {
            report += '⚠️ DATA UNAVAILABLE – Temporary data unavailable. Try again later.'
        } else {
            report += '⚠️ USE CAUTION – Review risks before interacting.'
        }
    } else {
        // Only LOW if ALL conditions met
        if (chainDetected && goPlusData && explorerData && 
            goPlusData.is_honeypot !== '1' && 
            (!goPlusData.owner_address || goPlusData.owner_address === '0x0000000000000000000000000000000000000000' ||
             (goPlusData.can_take_back_ownership !== '1' && goPlusData.is_blacklisted !== '1' && 
              goPlusData.selfdestruct !== '1' && goPlusData.is_mintable !== '1' && 
              goPlusData.transfer_pausable !== '1'))) {
            report += '✅ SAFE – No major risks detected, but always DYOR.'
        } else {
            report += '⚠️ USE CAUTION – Review risks before interacting.'
        }
    }

    // Explanation section
    report += `\n\nWhy this score?\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No major risks detected\n`
    }

    // Disclaimer
    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.`

    // Pre-buy warning if applicable
    if (isPreBuyQuery) {
        report += `\n\nRecommendation: `
        if (riskLevel === 'HIGH') {
            report += '🚨 Strongly avoid. High risk of loss.'
        } else if (riskLevel === 'MEDIUM') {
            report += '⚠️ Use caution. There are some risks here.'
        } else {
            report += '✅ Looks relatively safe, but always do your own research.'
        }
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
            '- Dexscreener (liquidity & trading data)\n' +
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
        'health check',
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
                const report = generateHealthReport(address, null, null, null, false, isPreBuy)
                await handler.sendMessage(channelId, report)
                return
            }
            
            // Fetch data for detected chain
            const [goPlusData, explorerData, dexscreenerData] = await Promise.allSettled([
                fetchGoPlusData(address, chainInfo.chainId),
                fetchExplorerData(address, chainInfo.chainName),
                fetchDexscreenerData(address, chainInfo.chainName),
            ])

            const report = generateHealthReport(
                address,
                goPlusData.status === 'fulfilled' ? goPlusData.value : null,
                explorerData.status === 'fulfilled' ? explorerData.value : null,
                dexscreenerData.status === 'fulfilled' ? dexscreenerData.value : null,
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
            '• `/health <solana_address>` (Solana)\n\n' +
            '**Note:** I need a contract or mint address, not a ticker symbol like $ETH or $TOWNS.',
        )
        return
    }

    // Reject ticker symbols
    if (isTickerSymbol(address)) {
        await handler.sendMessage(
            channelId,
            '❌ Please provide a contract or mint address, not a ticker symbol.\n\n' +
            '**Examples:**\n' +
            '• `/health 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (WETH address)\n' +
            '• `/health <solana_mint_address>` (Solana)\n\n' +
            'I need the actual blockchain address to analyze the token.',
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
                '• "@TokenHealth scan this contract <address>"\n\n' +
                '**Note:** I need a contract or mint address, not a ticker symbol like $ETH or $TOWNS.',
        )
        return
    }

    // Generic mention response
    await handler.sendMessage(
        channelId,
        'Hi! I\'m TokenHealth, your token safety scanner. Use `/health <address>` or mention me with an address to scan a token.\n\n' +
            '**Examples:**\n' +
            '• `/health 0x1234...5678`\n' +
            '• "@TokenHealth is this token safe? 0x1234...5678"\n\n' +
            '**Note:** I need a contract or mint address, not a ticker symbol.',
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
