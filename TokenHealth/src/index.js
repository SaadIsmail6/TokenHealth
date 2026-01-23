import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands.js'
import { isAddress } from 'viem'

// Well-known tokens with launch dates
const WELL_KNOWN_TOKENS = {
    '0xc02aa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Ethereum', launchDate: '2018-01-01' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', chain: 'Ethereum', launchDate: '2018-09-26' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', chain: 'Ethereum', launchDate: '2015-02-25' },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped BTC', symbol: 'WBTC', chain: 'Ethereum', launchDate: '2019-01-23' },
}

const CHAIN_IDS = {
    ETHEREUM: '1',
    BASE: '8453',
    ARBITRUM: '42161',
    BSC: '56',
}

// Check if input is a ticker symbol
function isTickerSymbol(input) {
    const trimmed = input.trim()
    if (trimmed.startsWith('$')) return true
    if (/^[A-Z]{2,10}$/.test(trimmed) && !trimmed.startsWith('0x') && trimmed.length < 10) return true
    return false
}

// Extract symbol from input
function extractSymbol(input) {
    const trimmed = input.trim().replace(/^\$/, '').toUpperCase()
    if (/^[A-Z]{2,10}$/.test(trimmed)) return trimmed
    return null
}

// Address type detection
function detectAddressType(address) {
    if (address.startsWith('0x') && address.length === 42 && isAddress(address)) {
        return 'evm'
    }
    const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    if (solanaPattern.test(address) && !address.match(/^[0-9a-fA-F]+$/)) {
        return 'solana'
    }
    return 'invalid'
}

// Resolve token symbol/name to address via CoinGecko
async function resolveTokenSymbol(symbol, chainName = null) {
    try {
        // Try CoinGecko search
        const searchResponse = await fetch(
            `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`,
            { headers: { 'Accept': 'application/json' } },
        )
        
        if (searchResponse.ok) {
            const searchData = await searchResponse.json()
            if (searchData.coins && searchData.coins.length > 0) {
                // Filter by chain if provided
                let matches = searchData.coins
                if (chainName) {
                    const chainMap = {
                        'Ethereum': 'ethereum',
                        'Base': 'base',
                        'Arbitrum': 'arbitrum',
                        'BSC': 'binance-smart-chain',
                    }
                    const chainId = chainMap[chainName]
                    // Note: CoinGecko search doesn't directly filter by chain, so we'll take first match
                }
                
                const topMatch = matches[0]
                if (topMatch.platforms) {
                    // Get first platform address
                    const platforms = Object.entries(topMatch.platforms)
                    if (platforms.length > 0) {
                        const [platform, address] = platforms[0]
                        return {
                            address,
                            name: topMatch.name,
                            symbol: topMatch.symbol?.toUpperCase(),
                            chain: platform === 'ethereum' ? 'Ethereum' : platform,
                            allMatches: matches.length > 1 ? matches : null,
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Token resolution error:', error)
    }
    return null
}

// Detect EVM chain
async function detectEVMChain(address) {
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
    
    for (const chain of chains) {
        try {
            const response = await fetch(
                `https://api.gopluslabs.io/api/v1/token_security/${chain.id}?contract_addresses=${address}`,
                { headers: { 'Accept': 'application/json' } },
            )
            if (response.ok) {
                const data = await response.json()
                if (data.result && data.result[address.toLowerCase()]) {
                    return { chainId: chain.id, chainName: chain.name }
                }
            }
        } catch (error) {
            continue
        }
    }
    
    if (address.startsWith('0x') && address.length === 42) {
        return { chainId: CHAIN_IDS.ETHEREUM, chainName: 'Ethereum' }
    }
    
    return null
}

// Calculate token age in hours
function calculateTokenAgeHours(launchDate, pairCreatedAt, creationTx) {
    const now = Date.now()
    
    if (launchDate) {
        const launch = new Date(launchDate).getTime()
        return (now - launch) / (1000 * 60 * 60)
    }
    
    if (pairCreatedAt) {
        const pairTime = pairCreatedAt * 1000
        return (now - pairTime) / (1000 * 60 * 60)
    }
    
    return null
}

// Format token age with risk indicators
function formatTokenAge(ageHours) {
    if (ageHours === null) {
        return '⚠️ Age unavailable (treat as high risk)'
    }
    if (ageHours < 1) {
        return '🆕 Just created (minutes ago)'
    }
    if (ageHours < 24) {
        return '🆕 Created today (high risk period)'
    }
    if (ageHours < 168) { // 1 week
        return `⚠️ ${Math.floor(ageHours / 24)} days old (new token)`
    }
    if (ageHours < 720) { // 1 month
        return `${Math.floor(ageHours / 24)} days old`
    }
    const months = Math.floor(ageHours / 720)
    if (months < 12) {
        return `${months} month${months > 1 ? 's' : ''} old`
    }
    const years = Math.floor(ageHours / 8760)
    return `${years} year${years > 1 ? 's' : ''} old (launched ${new Date().getFullYear() - years})`
}

// Fetch GoPlus data with retry
async function fetchGoPlusData(address, chainId, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(
                `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
                { headers: { 'Accept': 'application/json' } },
            )
            if (response.ok) {
                const data = await response.json()
                return data.result?.[address.toLowerCase()] || null
            }
        } catch (error) {
            if (i === retries) {
                console.error('GoPlus API error:', error)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
    return null
}

// Fetch Dexscreener data with retry
async function fetchDexscreenerData(address, chainName, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const chainMap = {
                'Ethereum': 'ethereum',
                'Base': 'base',
                'Arbitrum': 'arbitrum',
                'BSC': 'bsc',
            }
            const chainId = chainMap[chainName] || 'ethereum'
            
            const response = await fetch(
                `https://api.dexscreener.com/latest/dex/tokens/${address}`,
                { headers: { 'Accept': 'application/json' } },
            )
            
            if (response.ok) {
                const data = await response.json()
                if (data.pairs && data.pairs.length > 0) {
                    const sortedPairs = data.pairs
                        .filter(p => p.chainId === chainId)
                        .sort((a, b) => (parseFloat(b.liquidity?.usd || 0)) - (parseFloat(a.liquidity?.usd || 0)))
                    
                    if (sortedPairs.length > 0) {
                        const topPair = sortedPairs[0]
                        const pairTimes = sortedPairs
                            .map(p => p.pairCreatedAt)
                            .filter(t => t)
                            .sort((a, b) => a - b)
                        
                        return {
                            liquidityUsd: parseFloat(topPair.liquidity?.usd || 0),
                            volume24h: parseFloat(topPair.volume?.h24 || 0),
                            pairCreatedAt: pairTimes[0] || null,
                            pairCount: sortedPairs.length,
                        }
                    }
                }
            }
            return null
        } catch (error) {
            if (i === retries) {
                console.error('Dexscreener API error:', error)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
    return null
}

// Fetch explorer data with retry
async function fetchExplorerData(address, chainName, retries = 1) {
    for (let i = 0; i <= retries; i++) {
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
            
            const [creationResponse, tokenResponse, contractResponse] = await Promise.all([
                fetch(`${baseUrl}/api?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${apiKey}`),
                fetch(`${baseUrl}/api?module=token&action=tokeninfo&contractaddress=${address}&apikey=${apiKey}`),
                fetch(`${baseUrl}/api?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`),
            ])

            let tokenName = null
            let tokenSymbol = null
            let verified = false
            let creationTx = null
            
            const lowerAddress = address.toLowerCase()
            if (WELL_KNOWN_TOKENS[lowerAddress]) {
                const token = WELL_KNOWN_TOKENS[lowerAddress]
                tokenName = token.name
                tokenSymbol = token.symbol
                verified = true
            }
            
            if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json()
                if (tokenData.status === '1' && tokenData.result?.[0]) {
                    tokenName = tokenName || tokenData.result[0].tokenName || null
                    tokenSymbol = tokenSymbol || tokenData.result[0].symbol || null
                }
            }
            
            if (creationResponse.ok) {
                const creationData = await creationResponse.json()
                if (creationData.status === '1' && creationData.result?.[0]) {
                    creationTx = creationData.result[0].txHash
                }
            }
            
            if (contractResponse.ok) {
                const contractData = await contractResponse.json()
                if (contractData.status === '1' && contractData.result?.[0]) {
                    verified = verified || (contractData.result[0].SourceCode && contractData.result[0].SourceCode.trim() !== '')
                }
            }
            
            if (tokenName || creationTx || verified) {
                return {
                    chain: chainName,
                    creationTx,
                    source: explorerName.toLowerCase(),
                    tokenName: tokenName || 'Unknown',
                    tokenSymbol: tokenSymbol || null,
                    verified,
                }
            }
            
            return null
        } catch (error) {
            if (i === retries) {
                console.error('Explorer API error:', error)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
    return null
}

// Fetch Solscan data with retry
async function fetchSolscanData(address, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(
                `https://api.solscan.io/token/meta?token=${address}`,
                { headers: { 'Accept': 'application/json' } },
            )
            if (response.ok) {
                const data = await response.json()
                if (data) {
                    return {
                        chain: 'Solana',
                        tokenName: data.tokenName || data.name || data.tokenSymbol || 'Unknown',
                        tokenSymbol: data.tokenSymbol || data.symbol || 'Unknown',
                        mintAddress: address,
                        holderCount: data.holder || data.holderCount || null,
                        verified: data.verified !== false,
                        mintAuthority: data.mintAuthority || null,
                        freezeAuthority: data.freezeAuthority || null,
                        createdAt: data.createdAt || null,
                    }
                }
            }
            return null
        } catch (error) {
            if (i === retries) {
                console.error('Solscan API error:', error)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
    return null
}

// Fetch Dexscreener Solana data with retry
async function fetchDexscreenerSolana(address, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(
                `https://api.dexscreener.com/latest/dex/tokens/${address}`,
                { headers: { 'Accept': 'application/json' } },
            )
            if (response.ok) {
                const data = await response.json()
                if (data.pairs && data.pairs.length > 0) {
                    const solanaPairs = data.pairs.filter(p => p.chainId === 'solana')
                    if (solanaPairs.length > 0) {
                        const sortedPairs = solanaPairs.sort((a, b) => 
                            (parseFloat(b.liquidity?.usd || 0)) - (parseFloat(a.liquidity?.usd || 0))
                        )
                        const topPair = sortedPairs[0]
                        const pairTimes = solanaPairs
                            .map(p => p.pairCreatedAt)
                            .filter(t => t)
                            .sort((a, b) => a - b)
                        
                        return {
                            liquidityUsd: parseFloat(topPair.liquidity?.usd || 0),
                            volume24h: parseFloat(topPair.volume?.h24 || 0),
                            pairCreatedAt: pairTimes[0] || null,
                            pairCount: solanaPairs.length,
                        }
                    }
                }
            }
            return null
        } catch (error) {
            if (i === retries) {
                console.error('Dexscreener Solana error:', error)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
    return null
}

// Calculate health score (safety-first, penalize missing data)
function calculateHealthScore(goPlusData, explorerData, dexscreenerData, tokenAgeHours, chainDetected) {
    let score = 100
    const explanations = []
    let hasHighRisk = false
    let hasHoneypot = false
    let hasDangerousPrivileges = false
    let missingFields = 0
    let apiFailed = false

    // API failure penalty
    if (!goPlusData && !explorerData && !dexscreenerData) {
        score -= 25
        apiFailed = true
        missingFields += 3
        explanations.push('On-chain data temporarily unavailable')
    }

    // New token penalties (CRITICAL)
    if (tokenAgeHours !== null) {
        if (tokenAgeHours < 1) {
            score = Math.min(score, 40) // Max 40 for <1h tokens
            hasHighRisk = true
            explanations.push('Token created less than 1 hour ago (extreme rug risk)')
        } else if (tokenAgeHours < 24) {
            score = Math.min(score, 60) // Max 60 for <24h tokens
            hasHighRisk = true
            explanations.push('Token created less than 24 hours ago (high rug risk)')
        }
    } else {
        missingFields++
        score -= 20
        explanations.push('Token age unavailable (treat as high risk)')
    }

    if (goPlusData) {
        // Honeypot
        if (goPlusData.is_honeypot === '1') {
            score = Math.min(score, 20)
            hasHoneypot = true
            hasHighRisk = true
            explanations.push('Honeypot detected - tokens cannot be sold')
        }

        // Owner privileges
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

        if (hasDangerousPrivileges && !hasHoneypot) {
            score = Math.min(score, 50)
            hasHighRisk = true
            explanations.push(...ownerRisks.slice(0, 3))
        }

        // Holder count
        if (goPlusData.holder_count) {
            const holderCount = parseInt(goPlusData.holder_count)
            if (holderCount < 50) {
                score -= 20
                explanations.push('Very low holder count (<50)')
            } else if (holderCount > 1000) {
                explanations.push('Good holder distribution')
            }
        } else {
            missingFields++
        }
    } else {
        missingFields++
    }

    // Liquidity check (CRITICAL)
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd === 0 || dexscreenerData.liquidityUsd < 1000) {
            score = Math.min(score, 40)
            hasHighRisk = true
            explanations.push('No active liquidity detected (rug risk)')
        } else if (dexscreenerData.liquidityUsd < 10000) {
            score -= 15
            explanations.push('Low initial liquidity')
        } else {
            explanations.push('Liquidity detected')
        }
    } else {
        score = Math.min(score, 50) // Force high risk if no liquidity data
        hasHighRisk = true
        missingFields++
        explanations.push('Liquidity data unavailable (rug risk)')
    }

    // Contract verification
    if (explorerData?.verified) {
        explanations.push('Contract is verified')
    } else {
        score -= 15
        missingFields++
        explanations.push('Contract not verified or explorer unavailable')
    }

    // Missing fields penalty (3+ = force HIGH)
    if (missingFields >= 3) {
        score = Math.min(score, 40)
        hasHighRisk = true
        explanations.push('Insufficient on-chain data')
    }

    score = Math.max(0, Math.min(100, score))

    // Risk level determination
    let riskLevel = 'LOW'
    let riskEmoji = '✅'
    
    if (hasHighRisk || score < 60 || apiFailed || missingFields >= 3) {
        riskLevel = 'HIGH'
        riskEmoji = '🔴'
    } else if (score < 80) {
        riskLevel = 'MEDIUM'
        riskEmoji = '⚠️'
    } else {
        // Only LOW if ALL conditions perfect
        if (!chainDetected || !goPlusData || !explorerData || !dexscreenerData || 
            hasHoneypot || hasDangerousPrivileges || missingFields > 0 || tokenAgeHours === null) {
            riskLevel = 'MEDIUM'
            riskEmoji = '⚠️'
            score = Math.min(score, 79)
        }
    }

    return { score, riskLevel, riskEmoji, explanations: explanations.slice(0, 5) }
}

// Generate Solana report (safety-first)
function generateSolanaReport(address, solscanData, dexscreenerData, isPreBuyQuery = false) {
    let report = '🩺 TokenHealth Report\n\n'
    
    const tokenName = solscanData?.tokenName || 'Unknown'
    const tokenSymbol = solscanData?.tokenSymbol || ''
    const chain = 'Solana'
    
    report += `Token: ${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}\n`
    report += `Chain: ${chain}\n`
    report += `Address: ${address}\n\n`

    // Calculate token age
    const tokenAgeHours = calculateTokenAgeHours(
        solscanData?.createdAt ? new Date(solscanData.createdAt).toISOString() : null,
        dexscreenerData?.pairCreatedAt,
        null
    )

    let score = 100
    const explanations = []
    let hasMintAuthority = false
    let hasFreezeAuthority = false
    let missingFields = 0

    // New token penalties
    if (tokenAgeHours !== null) {
        if (tokenAgeHours < 1) {
            score = Math.min(score, 40)
            explanations.push('Token created less than 1 hour ago (extreme rug risk)')
        } else if (tokenAgeHours < 24) {
            score = Math.min(score, 60)
            explanations.push('Token created less than 24 hours ago (high rug risk)')
        }
    } else {
        missingFields++
        score -= 20
    }

    if (solscanData) {
        if (solscanData.verified) {
            explanations.push('Token metadata is verified on Solscan')
        } else {
            score -= 10
            missingFields++
        }

        if (solscanData.mintAuthority && solscanData.mintAuthority !== '11111111111111111111111111111111') {
            score -= 20
            hasMintAuthority = true
            explanations.push('Mint authority is active')
        }

        if (solscanData.freezeAuthority && solscanData.freezeAuthority !== '11111111111111111111111111111111') {
            score -= 15
            hasFreezeAuthority = true
            explanations.push('Freeze authority is active')
        }

        if (solscanData.holderCount) {
            const holderCount = typeof solscanData.holderCount === 'string' 
                ? parseInt(solscanData.holderCount) 
                : solscanData.holderCount
            if (holderCount < 50) {
                score -= 20
                explanations.push('Very low holder count')
            }
        } else {
            missingFields++
        }
    } else {
        missingFields += 2
        score -= 25
    }

    // Liquidity check (CRITICAL)
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd === 0 || dexscreenerData.liquidityUsd < 1000) {
            score = Math.min(score, 40)
            explanations.push('No active liquidity pool detected (rug risk)')
        } else if (dexscreenerData.liquidityUsd < 10000) {
            score -= 15
            explanations.push('Low initial liquidity')
        }
    } else {
        score = Math.min(score, 50)
        missingFields++
        explanations.push('Liquidity data unavailable (rug risk)')
    }

    if (missingFields >= 3) {
        score = Math.min(score, 40)
        explanations.push('Insufficient on-chain data')
    }

    score = Math.max(0, Math.min(95, score))

    let riskLevel = 'MEDIUM'
    let riskEmoji = '⚠️'
    if (score < 60 || missingFields >= 3 || (hasMintAuthority && hasFreezeAuthority)) {
        riskLevel = 'HIGH'
        riskEmoji = '🔴'
    } else if (score >= 80 && !hasMintAuthority && !hasFreezeAuthority && dexscreenerData && tokenAgeHours > 24) {
        riskLevel = 'LOW'
        riskEmoji = '✅'
    }
    
    report += `Health Score: ${score} / 100\n`
    report += `Risk Level: ${riskEmoji} ${riskLevel}\n\n`

    // Fields
    report += `Honeypot Risk: ✅\n`
    
    if (hasMintAuthority || hasFreezeAuthority) {
        const authorities = []
        if (hasMintAuthority) authorities.push('Mint')
        if (hasFreezeAuthority) authorities.push('Freeze')
        report += `Owner Privileges: ⚠️ ${authorities.join(' & ')} authority active\n`
    } else {
        report += `Owner Privileges: ✅ No active authorities\n`
    }
    
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd === 0 || dexscreenerData.liquidityUsd < 1000) {
            report += `Liquidity Status: ❌ No active liquidity pool detected (rug risk)\n`
        } else if (dexscreenerData.liquidityUsd < 10000) {
            report += `Liquidity Status: ⚠️ Low initial liquidity\n`
        } else {
            report += `Liquidity Status: ✅ Liquidity detected\n`
        }
    } else {
        report += `Liquidity Status: ❌ No active liquidity pool detected (rug risk)\n`
    }
    
    if (solscanData?.verified) {
        report += `Contract Verified: ✅ Yes (Solscan)\n`
    } else {
        report += `Contract Verified: ⚠️ Contract not verified or explorer unavailable\n`
    }

    report += `Token Age: ${formatTokenAge(tokenAgeHours)}\n`

    if (solscanData?.holderCount) {
        const holderCount = typeof solscanData.holderCount === 'string' 
            ? parseInt(solscanData.holderCount) 
            : solscanData.holderCount
        report += `Holder Count: ${holderCount.toLocaleString()}\n`
    } else {
        report += `Holder Count: ⚠️ Holder data unavailable (early or risky token)\n`
    }

    // Final Verdict
    report += `\nFinal Verdict: `
    if (riskLevel === 'HIGH') {
        report += '🔴 HIGH RISK – Token shows elevated rug or scam risk. Avoid interacting.'
    } else if (riskLevel === 'MEDIUM') {
        report += '⚠️ REVIEW RECOMMENDED – Some risk factors or limited history detected.'
    } else {
        report += '✅ LOW RISK – No major red flags detected, but always DYOR.'
    }

    report += `\n\nWhy this score?\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No critical issues detected in available data\n`
    }

    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.\n`
    report += `Halal notice: TokenHealth provides information only and does not facilitate trading or gambling.`

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

// Generate EVM health report (safety-first)
function generateHealthReport(address, goPlusData, explorerData, dexscreenerData, tokenAgeHours, chainDetected, isPreBuyQuery = false) {
    let report = '🩺 TokenHealth Report\n\n'
    
    const lowerAddress = address.toLowerCase()
    const wellKnown = WELL_KNOWN_TOKENS[lowerAddress]
    
    const tokenName = wellKnown?.name || explorerData?.tokenName || goPlusData?.token_name || 'Unknown'
    const tokenSymbol = wellKnown?.symbol || explorerData?.tokenSymbol || goPlusData?.token_symbol || ''
    const chain = wellKnown?.chain || explorerData?.chain || (chainDetected ? 'Ethereum' : 'Unknown')
    
    report += `Token: ${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}\n`
    report += `Chain: ${chain}\n`
    report += `Address: ${address}\n\n`

    const { score, riskLevel, riskEmoji, explanations } = calculateHealthScore(
        goPlusData, explorerData, dexscreenerData, tokenAgeHours, chainDetected
    )
    
    report += `Health Score: ${score} / 100\n`
    report += `Risk Level: ${riskEmoji} ${riskLevel}\n\n`

    // Honeypot Risk
    if (goPlusData) {
        if (goPlusData.is_honeypot === '1') {
            report += `Honeypot Risk: ❌\n`
        } else {
            report += `Honeypot Risk: ✅\n`
        }
    } else {
        report += `Honeypot Risk: ⚠️ Data unavailable (treat as high risk)\n`
    }

    // Owner Privileges
    if (goPlusData) {
        const ownerRisks = []
        if (goPlusData.owner_address && goPlusData.owner_address !== '0x0000000000000000000000000000000000000000') {
            if (goPlusData.can_take_back_ownership === '1') ownerRisks.push('Can take back ownership')
            if (goPlusData.is_blacklisted === '1') ownerRisks.push('Blacklist function')
            if (goPlusData.selfdestruct === '1') ownerRisks.push('Self-destruct')
            if (goPlusData.is_mintable === '1') ownerRisks.push('Mintable')
            if (goPlusData.transfer_pausable === '1') ownerRisks.push('Transfer pausable')
        }
        
        if (ownerRisks.length > 0) {
            report += `Owner Privileges: ⚠️\n`
        } else {
            report += `Owner Privileges: ✅\n`
        }
    } else {
        report += `Owner Privileges: ⚠️ Data unavailable (treat as high risk)\n`
    }

    // Liquidity Status
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd === 0 || dexscreenerData.liquidityUsd < 1000) {
            report += `Liquidity Status: ❌ No active liquidity pool detected (rug risk)\n`
        } else if (dexscreenerData.liquidityUsd < 10000) {
            report += `Liquidity Status: ⚠️ Low initial liquidity\n`
        } else {
            report += `Liquidity Status: ✅ Liquidity detected\n`
        }
    } else {
        report += `Liquidity Status: ❌ No active liquidity pool detected (rug risk)\n`
    }

    // Contract Verified
    if (explorerData?.verified || wellKnown) {
        report += `Contract Verified: ✅ Yes (${explorerData?.source || 'Etherscan'})\n`
    } else {
        report += `Contract Verified: ⚠️ Contract not verified or explorer unavailable\n`
    }

    // Token Age
    report += `Token Age: ${formatTokenAge(tokenAgeHours)}\n`

    // Holder Count
    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        report += `Holder Count: ${holderCount.toLocaleString()}\n`
    } else {
        report += `Holder Count: ⚠️ Holder data unavailable (early or risky token)\n`
    }

    // Final Verdict
    report += `\nFinal Verdict: `
    
    if (riskLevel === 'HIGH') {
        if (!goPlusData && !explorerData && !dexscreenerData) {
            report += '🔴 HIGH RISK – Insufficient or failed on-chain data. Treat as unsafe.'
        } else {
            report += '🔴 HIGH RISK – Token shows elevated rug or scam risk. Avoid interacting.'
        }
    } else if (riskLevel === 'MEDIUM') {
        report += '⚠️ REVIEW RECOMMENDED – Some risk factors or limited history detected.'
    } else {
        report += '✅ LOW RISK – No major red flags detected, but always DYOR.'
    }

    report += `\n\nWhy this score?\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No critical issues detected in available data\n`
    }

    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.\n`
    report += `Halal notice: TokenHealth provides information only and does not facilitate trading or gambling.`

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
            'TokenHealth helps you check if a token or contract looks safe before interacting with it.\n\n' +
            '**How to use:**\n\n' +
            '• **Slash command:**\n' +
            '`/health <token_address | symbol | name>`\n\n' +
            '• **Or mention me naturally:**\n' +
            '"@TokenHealth is this token safe? <address>"\n' +
            '"@TokenHealth check $PEPE"\n' +
            '"@TokenHealth scan this contract"\n\n' +
            '**Supported chains:**\n' +
            '- **EVM:** Ethereum, Base, Arbitrum, BSC\n' +
            '- **Solana:** Full analysis mode\n\n' +
            '**What I check:**\n\n' +
            '✅ Token name & chain\n' +
            '🚨 Risk level + health score\n' +
            '🍯 Honeypot behavior\n' +
            '🔑 Owner privileges (mint, pause, blacklist)\n' +
            '💧 Liquidity status\n' +
            '📜 Contract verification\n' +
            '⏳ Token age\n' +
            '👥 Holder count\n\n' +
            '**Data sources:**\n' +
            '- GoPlus Security API\n' +
            '- Etherscan / Basescan / Arbiscan / BscScan\n' +
            '- Dexscreener (liquidity & trading data)\n' +
            '- Solscan (Solana)\n\n' +
            '**Important:**\n' +
            '- This bot is **read-only** and **non-custodial**\n' +
            '- Results are **informational only**, not financial advice\n' +
            '- Always do your own research (DYOR)\n\n' +
            '**Disclaimer:**\n' +
            'Not financial advice. TokenHealth provides automated risk analysis only. Always DYOR.',
    )
})

function isSafetyQuery(message) {
    const lowerMessage = message.toLowerCase()
    const triggers = [
        'is this token safe', 'check this contract', 'scan this address', 'scan this contract',
        'any red flags', 'should i buy', 'explain this token', 'check this token', 'analyze this',
        'is this safe', 'token safety', 'contract safety', 'is it safe', 'thinking of aping',
        'is this a good buy', 'should i invest', 'health check', 'check',
    ]
    return triggers.some(trigger => lowerMessage.includes(trigger))
}

function isPreBuyQuery(message) {
    const lowerMessage = message.toLowerCase()
    const preBuyTriggers = [
        'should i buy', 'thinking of aping', 'is this a good buy', 'should i invest',
        'is it worth buying', 'should i get',
    ]
    return preBuyTriggers.some(trigger => lowerMessage.includes(trigger))
}

function extractAddress(message) {
    const evmMatch = message.match(/0x[a-fA-F0-9]{40}/)
    if (evmMatch && isAddress(evmMatch[0])) {
        return { address: evmMatch[0], type: 'evm' }
    }
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

function extractSymbol(message) {
    const symbolMatch = message.match(/\$([A-Z]{2,10})\b/i)
    if (symbolMatch) return symbolMatch[1].toUpperCase()
    const wordMatch = message.match(/\b([A-Z]{2,10})\b/)
    if (wordMatch && isTickerSymbol(wordMatch[1])) return wordMatch[1].toUpperCase()
    return null
}

function isBotMentioned(message, botName = 'TokenHealth') {
    const lowerMessage = message.toLowerCase()
    const lowerBotName = botName.toLowerCase()
    return lowerMessage.includes(`@${lowerBotName}`) || 
           lowerMessage.includes(`@${lowerBotName.toLowerCase()}`) ||
           (lowerMessage.includes(lowerBotName) && lowerMessage.includes('@'))
}

async function analyzeToken(handler, channelId, address, addressType, isPreBuy = false) {
    try {
        await handler.sendMessage(channelId, '🔍 Analyzing token safety... This may take a moment.')

        if (addressType === 'solana') {
            const [solscanData, dexscreenerData] = await Promise.allSettled([
                fetchSolscanData(address),
                fetchDexscreenerSolana(address),
            ])
            
            const tokenAgeHours = calculateTokenAgeHours(
                solscanData.status === 'fulfilled' && solscanData.value?.createdAt 
                    ? new Date(solscanData.value.createdAt).toISOString() 
                    : null,
                dexscreenerData.status === 'fulfilled' && dexscreenerData.value?.pairCreatedAt
                    ? dexscreenerData.value.pairCreatedAt
                    : null,
                null
            )
            
            const report = generateSolanaReport(
                address,
                solscanData.status === 'fulfilled' ? solscanData.value : null,
                dexscreenerData.status === 'fulfilled' ? dexscreenerData.value : null,
                isPreBuy,
            )
            await handler.sendMessage(channelId, report)
        } else if (addressType === 'evm') {
            const chainInfo = await detectEVMChain(address)
            
            if (!chainInfo) {
                const report = generateHealthReport(address, null, null, null, null, false, isPreBuy)
                await handler.sendMessage(channelId, report)
                return
            }
            
            const [goPlusData, explorerData, dexscreenerData] = await Promise.allSettled([
                fetchGoPlusData(address, chainInfo.chainId),
                fetchExplorerData(address, chainInfo.chainName),
                fetchDexscreenerData(address, chainInfo.chainName),
            ])

            const wellKnown = WELL_KNOWN_TOKENS[address.toLowerCase()]
            const tokenAgeHours = calculateTokenAgeHours(
                wellKnown?.launchDate,
                dexscreenerData.status === 'fulfilled' && dexscreenerData.value?.pairCreatedAt
                    ? dexscreenerData.value.pairCreatedAt
                    : null,
                explorerData.status === 'fulfilled' && explorerData.value?.creationTx
                    ? explorerData.value.creationTx
                    : null
            )

            const report = generateHealthReport(
                address,
                goPlusData.status === 'fulfilled' ? goPlusData.value : null,
                explorerData.status === 'fulfilled' ? explorerData.value : null,
                dexscreenerData.status === 'fulfilled' ? dexscreenerData.value : null,
                tokenAgeHours,
                true,
                isPreBuy,
            )

            await handler.sendMessage(channelId, report)
        } else {
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
    const input = args.join(' ').trim()
    
    if (!input) {
        await handler.sendMessage(
            channelId,
            '❌ Please provide a token address, symbol, or name.\n\n**Usage:** `/health <token | address | symbol>`\n**Examples:**\n' +
            '• `/health 0x1234...5678` (address)\n' +
            '• `/health WETH` (symbol)\n' +
            '• `/health $PEPE` (symbol with $)\n' +
            '• `/health <solana_address>` (Solana)',
        )
        return
    }

    // Check if it's an address
    const addressType = detectAddressType(input)
    if (addressType !== 'invalid') {
        await analyzeToken(handler, channelId, input, addressType, false)
        return
    }

    // Try to resolve as symbol
    const symbol = extractSymbol(input)
    if (symbol) {
        await handler.sendMessage(channelId, `🔍 Resolving token symbol "${symbol}"...`)
        const resolved = await resolveTokenSymbol(symbol)
        if (resolved && resolved.address) {
            if (resolved.allMatches && resolved.allMatches.length > 1) {
                await handler.sendMessage(
                    channelId,
                    `Multiple tokens found for "${symbol}". Please specify the chain or use the contract address directly.\n\n` +
                    `Found: ${resolved.name} on ${resolved.chain}\n` +
                    `Address: ${resolved.address}`,
                )
                return
            }
            const addrType = detectAddressType(resolved.address)
            await analyzeToken(handler, channelId, resolved.address, addrType, false)
        } else {
            await handler.sendMessage(
                channelId,
                `❌ Token "${symbol}" not found. Please provide a contract address or check the symbol spelling.`,
            )
        }
        return
    }

    await handler.sendMessage(
        channelId,
        '❌ Invalid input. Please provide:\n' +
        '• A contract address (0x... for EVM, base58 for Solana)\n' +
        '• A token symbol (WETH, USDC, PEPE, etc.)\n' +
        '• A token name',
    )
})

bot.onMessage(async (handler, { message, channelId, isMentioned }) => {
    if (!isMentioned) return
    if (!isBotMentioned(message)) return

    const addressData = extractAddress(message)
    const symbol = extractSymbol(message)
    const isPreBuy = isPreBuyQuery(message)

    if (addressData && addressData.address) {
        await analyzeToken(handler, channelId, addressData.address, addressData.type, isPreBuy)
        return
    }

    if (symbol) {
        await handler.sendMessage(channelId, `🔍 Resolving token symbol "${symbol}"...`)
        const resolved = await resolveTokenSymbol(symbol)
        if (resolved && resolved.address) {
            if (resolved.allMatches && resolved.allMatches.length > 1) {
                await handler.sendMessage(
                    channelId,
                    `Multiple tokens found for "${symbol}". Please specify the chain or use the contract address directly.\n\n` +
                    `Found: ${resolved.name} on ${resolved.chain}\n` +
                    `Address: ${resolved.address}`,
                )
                return
            }
            const addrType = detectAddressType(resolved.address)
            await analyzeToken(handler, channelId, resolved.address, addrType, isPreBuy)
        } else {
            await handler.sendMessage(
                channelId,
                `❌ Token "${symbol}" not found. Please provide a contract address or check the symbol spelling.`,
            )
        }
        return
    }

    if (isSafetyQuery(message)) {
        await handler.sendMessage(
            channelId,
            'Please include a token address or symbol so I can scan it.\n\n' +
                '**Examples:**\n' +
                '• "@TokenHealth is this token safe? 0x1234...5678"\n' +
                '• "@TokenHealth check $PEPE"\n' +
                '• "@TokenHealth scan this contract <address>"',
        )
        return
    }

    await handler.sendMessage(
        channelId,
        'Hi! I\'m TokenHealth, your token safety scanner. Use `/health <address | symbol>` or mention me with a token.\n\n' +
            '**Examples:**\n' +
            '• `/health 0x1234...5678`\n' +
            '• `/health WETH`\n' +
            '• "@TokenHealth check $PEPE"',
    )
})

bot.onReaction(async (handler, { reaction, channelId }) => {
    if (reaction === '👋') {
        await handler.sendMessage(channelId, 'I saw your wave! 👋')
    }
})

const app = bot.start()

app.get('/', async (c) => {
    if (c.req.method === 'HEAD') {
        return c.text('', 200)
    }
    return c.json({ status: 'ok', service: 'TokenHealth Bot' })
})

app.get('/.well-known/agent-metadata.json', async (c) => {
    return c.json(await bot.getIdentityMetadata())
})

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

export default app
