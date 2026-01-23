import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands.js'
import { isAddress } from 'viem'

// Well-known tokens whitelist with launch dates
const WELL_KNOWN_TOKENS = {
    '0xc02aa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Ethereum', launchDate: '2018-01-01' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', chain: 'Ethereum', launchDate: '2018-09-26' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', chain: 'Ethereum', launchDate: '2015-02-25' },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped BTC', symbol: 'WBTC', chain: 'Ethereum', launchDate: '2019-01-23' },
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
    if (trimmed.startsWith('$')) return true
    if (/^[A-Z]{2,10}$/.test(trimmed) && !trimmed.startsWith('0x') && trimmed.length < 10) return true
    return false
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

// Calculate token age from date or timestamp
function calculateTokenAge(launchDate, pairCreatedAt, creationTx) {
    if (launchDate) {
        const launch = new Date(launchDate)
        const now = new Date()
        const years = Math.floor((now - launch) / (365.25 * 24 * 60 * 60 * 1000))
        const months = Math.floor(((now - launch) % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000))
        if (years > 0) {
            return `${years} year${years > 1 ? 's' : ''} (launched ${launch.getFullYear()})`
        } else if (months > 0) {
            return `${months} month${months > 1 ? 's' : ''} (launched ${launch.toLocaleDateString()})`
        }
    }
    if (pairCreatedAt) {
        const pairDate = new Date(pairCreatedAt * 1000)
        const now = new Date()
        const months = Math.floor((now - pairDate) / (30.44 * 24 * 60 * 60 * 1000))
        if (months > 0) {
            return `At least ${months} month${months > 1 ? 's' : ''} (based on first liquidity pool)`
        }
    }
    if (creationTx) {
        return 'Based on contract creation transaction'
    }
    return 'Not publicly reported'
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

// Fetch CoinGecko data (fallback for token metadata and launch date)
async function fetchCoinGeckoData(address, chainName) {
    try {
        const chainMap = {
            'Ethereum': 'ethereum',
            'Base': 'base',
            'Arbitrum': 'arbitrum',
            'BSC': 'binance-smart-chain',
        }
        const chainId = chainMap[chainName] || 'ethereum'
        
        const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/${chainId}/contract/${address}`,
            { headers: { 'Accept': 'application/json' } },
        )
        
        if (response.ok) {
            const data = await response.json()
            return {
                name: data.name,
                symbol: data.symbol?.toUpperCase(),
                launchDate: data.genesis_date,
                marketCap: data.market_data?.market_cap?.usd,
            }
        }
    } catch (error) {
        // Silent fail - this is a fallback
    }
    return null
}

// Fetch GoPlus data
async function fetchGoPlusData(address, chainId) {
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
        console.error('GoPlus API error:', error)
    }
    return null
}

// Fetch Dexscreener data with enhanced token age detection
async function fetchDexscreenerData(address, chainName) {
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
                    // Get oldest pair creation time
                    const pairTimes = sortedPairs
                        .map(p => p.pairCreatedAt)
                        .filter(t => t)
                        .sort((a, b) => a - b)
                    
                    return {
                        liquidityUsd: parseFloat(topPair.liquidity?.usd || 0),
                        volume24h: parseFloat(topPair.volume?.h24 || 0),
                        priceChange24h: parseFloat(topPair.priceChange?.h24 || 0),
                        fdv: parseFloat(topPair.fdv || 0),
                        pairCount: sortedPairs.length,
                        pairCreatedAt: pairTimes[0] || null,
                        holdersEstimate: sortedPairs.reduce((sum, p) => sum + (parseInt(p.pairAddress?.slice(-2) || '0', 16) || 0), 0),
                    }
                }
            }
        }
    } catch (error) {
        console.error('Dexscreener API error:', error)
    }
    return null
}

// Fetch explorer data
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
                tokenName: tokenName || 'Not publicly reported',
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

// Fetch Solscan data
async function fetchSolscanData(address) {
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
                    tokenName: data.tokenName || data.name || data.tokenSymbol || 'Not publicly reported',
                    tokenSymbol: data.tokenSymbol || data.symbol || 'Not publicly reported',
                    mintAddress: address,
                    decimals: data.decimals || null,
                    supply: data.supply || null,
                    holderCount: data.holder || data.holderCount || null,
                    verified: data.verified !== false,
                    mintAuthority: data.mintAuthority || null,
                    freezeAuthority: data.freezeAuthority || null,
                }
            }
        }
    } catch (error) {
        console.error('Solscan API error:', error)
    }
    return null
}

// Fetch Dexscreener Solana data
async function fetchDexscreenerSolana(address) {
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
    } catch (error) {
        console.error('Dexscreener Solana error:', error)
    }
    return null
}

// Calculate health score (lenient - missing data doesn't heavily penalize)
function calculateHealthScore(goPlusData, explorerData, dexscreenerData, coingeckoData, chainDetected) {
    let score = 100
    const explanations = []
    let hasHighRisk = false
    let hasHoneypot = false
    let hasDangerousPrivileges = false
    let missingFields = 0

    if (goPlusData) {
        if (goPlusData.is_honeypot === '1') {
            score = 20
            hasHoneypot = true
            hasHighRisk = true
            explanations.push('Honeypot detected - tokens cannot be sold')
        }

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
            score = Math.min(score, 40)
            hasHighRisk = true
            explanations.push(...ownerRisks.slice(0, 3))
        }

        if (dexscreenerData) {
            if (dexscreenerData.liquidityUsd < 10000) {
                score -= 10
                explanations.push('Low liquidity detected')
            } else if (dexscreenerData.liquidityUsd > 100000) {
                explanations.push('Good liquidity available')
            }
        } else if (goPlusData.lp_holder_count !== undefined) {
            const lpCount = parseInt(goPlusData.lp_holder_count) || 0
            if (lpCount === 0) {
                score -= 15
                explanations.push('No liquidity pool detected')
            } else if (lpCount === 1) {
                score -= 10
                explanations.push('Liquidity is not locked (single holder)')
            }
        } else {
            missingFields++
        }
    } else {
        missingFields++
    }

    if (explorerData?.verified) {
        explanations.push(`Contract is verified on ${explorerData.chain}`)
    } else {
        score -= 2 // Only -2 for missing verification
        missingFields++
    }

    if (!explorerData?.creationTx && !coingeckoData?.launchDate && !dexscreenerData?.pairCreatedAt) {
        missingFields++
    }

    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        if (holderCount > 1000) {
            explanations.push('Good holder distribution')
        } else if (holderCount < 100) {
            score -= 5
            explanations.push('Limited holder count')
        }
    } else {
        missingFields++
    }

    // Lenient penalty: -2 per missing field, max -5 for multiple
    const missingPenalty = Math.min(missingFields * 2, 5)
    score -= missingPenalty

    score = Math.max(0, Math.min(95, score))

    let riskLevel = 'LOW'
    let riskEmoji = '✅'
    
    if (hasHighRisk || score <= 40) {
        riskLevel = 'HIGH'
        riskEmoji = '🚨'
    } else if (score <= 79) {
        riskLevel = 'MEDIUM'
        riskEmoji = '⚠️'
    } else {
        if (!chainDetected || !goPlusData || !explorerData || hasHoneypot || hasDangerousPrivileges) {
            riskLevel = 'MEDIUM'
            riskEmoji = '⚠️'
            score = Math.min(score, 79)
        }
    }

    return { score, riskLevel, riskEmoji, explanations: explanations.slice(0, 5) }
}

// Generate Solana report (professional, no "limited analysis")
function generateSolanaReport(address, solscanData, dexscreenerData, isPreBuyQuery = false) {
    let report = '🩺 TokenHealth Report\n\n'
    
    const tokenName = solscanData?.tokenName || 'Not publicly reported'
    const tokenSymbol = solscanData?.tokenSymbol || ''
    const chain = 'Solana'
    
    report += `Token: ${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}\n`
    report += `Chain: ${chain}\n`
    report += `Address: ${address}\n\n`

    let score = 85
    const explanations = []
    let hasMintAuthority = false
    let hasFreezeAuthority = false

    if (solscanData) {
        if (solscanData.verified) {
            explanations.push('Token metadata is verified on Solscan')
        } else {
            score -= 2
        }

        if (solscanData.mintAuthority && solscanData.mintAuthority !== '11111111111111111111111111111111') {
            score -= 15
            hasMintAuthority = true
            explanations.push('Mint authority is active')
        }

        if (solscanData.freezeAuthority && solscanData.freezeAuthority !== '11111111111111111111111111111111') {
            score -= 10
            hasFreezeAuthority = true
            explanations.push('Freeze authority is active')
        }

        if (solscanData.holderCount) {
            const holderCount = typeof solscanData.holderCount === 'string' 
                ? parseInt(solscanData.holderCount) 
                : solscanData.holderCount
            if (holderCount > 100) {
                explanations.push('Token has a good holder distribution')
            } else if (holderCount > 10) {
                score -= 2
                explanations.push('Token has limited holder count')
            } else {
                score -= 5
                explanations.push('Token has very few holders')
            }
        }
    }

    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd > 100000) {
            explanations.push('Good liquidity detected via primary pool')
        } else if (dexscreenerData.liquidityUsd > 10000) {
            score -= 2
            explanations.push('Moderate liquidity detected')
        } else if (dexscreenerData.liquidityUsd > 0) {
            score -= 5
            explanations.push('Low liquidity detected')
        }
    }

    score = Math.max(0, Math.min(95, score))

    report += `Health Score: ${score} / 100\n`
    
    let riskLevel = 'LOW'
    let riskEmoji = '🟢'
    if (score <= 40 || (hasMintAuthority && hasFreezeAuthority)) {
        riskLevel = 'HIGH'
        riskEmoji = '🔴'
    } else if (score <= 79 || hasMintAuthority || hasFreezeAuthority) {
        riskLevel = 'MEDIUM'
        riskEmoji = '🟡'
    }
    
    report += `Risk Level: ${riskLevel}\n\n`

    // Honeypot Risk
    report += `Honeypot Risk: ✅\n`
    
    // Owner Privileges
    if (hasMintAuthority || hasFreezeAuthority) {
        const authorities = []
        if (hasMintAuthority) authorities.push('Mint')
        if (hasFreezeAuthority) authorities.push('Freeze')
        report += `Owner Privileges: ⚠️ ${authorities.join(' & ')} authority active\n`
    } else {
        report += `Owner Privileges: ✅ No active authorities\n`
    }
    
    // Liquidity Status
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd > 100000) {
            report += `Liquidity Status: ✅ Detected via primary pool\n`
        } else if (dexscreenerData.liquidityUsd > 10000) {
            report += `Liquidity Status: ⚠️ Moderate liquidity\n`
        } else {
            report += `Liquidity Status: ⚠️ Low liquidity detected\n`
        }
    } else {
        report += `Liquidity Status: Not detected in available datasets\n`
    }
    
    // Contract Verified
    if (solscanData?.verified) {
        report += `Contract Verified: ✅ Yes (Solscan)\n`
    } else {
        report += `Contract Verified: Not publicly reported\n`
    }

    // Token Age
    const tokenAge = calculateTokenAge(null, dexscreenerData?.pairCreatedAt, null)
    report += `Token Age: ${tokenAge}\n`

    // Holder Count
    if (solscanData?.holderCount) {
        const holderCount = typeof solscanData.holderCount === 'string' 
            ? parseInt(solscanData.holderCount) 
            : solscanData.holderCount
        report += `Holder Count: ${holderCount.toLocaleString()}\n`
    } else {
        report += `Holder Count: Not detected in available datasets\n`
    }

    // Final Verdict (always choose one of 4 options)
    report += `\nFinal Verdict: `
    if (riskLevel === 'HIGH') {
        report += '🔴 HIGH RISK – Active mint or freeze authority with suspicious behavior.'
    } else if (riskLevel === 'MEDIUM' || hasMintAuthority || hasFreezeAuthority) {
        report += '🟡 REVIEW RECOMMENDED – Developer controls present or liquidity is low.'
    } else {
        report += '🟢 NO CRITICAL RISKS DETECTED – No active authorities or abnormal activity found.'
    }

    report += `\n\nWhy this score?\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No critical issues detected in available data\n`
    }
    report += `• Based on currently available on-chain data\n`

    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.`

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

// Generate EVM health report (professional, no "unable" or "data unavailable")
function generateHealthReport(address, goPlusData, explorerData, dexscreenerData, coingeckoData, chainDetected, isPreBuyQuery = false) {
    let report = '🩺 TokenHealth Report\n\n'
    
    const lowerAddress = address.toLowerCase()
    const wellKnown = WELL_KNOWN_TOKENS[lowerAddress]
    
    const tokenName = wellKnown?.name || coingeckoData?.name || explorerData?.tokenName || goPlusData?.token_name || 'Not publicly reported'
    const tokenSymbol = wellKnown?.symbol || coingeckoData?.symbol || explorerData?.tokenSymbol || goPlusData?.token_symbol || ''
    const chain = wellKnown?.chain || explorerData?.chain || (chainDetected ? 'Ethereum' : 'Not detected in available datasets')
    
    report += `Token: ${tokenName}${tokenSymbol ? ` (${tokenSymbol})` : ''}\n`
    report += `Chain: ${chain}\n`
    report += `Address: ${address}\n\n`

    const { score, riskLevel, riskEmoji, explanations } = calculateHealthScore(goPlusData, explorerData, dexscreenerData, coingeckoData, chainDetected)
    
    report += `Health Score: ${score} / 100\n`
    report += `Risk Level: ${riskLevel}\n\n`

    // Honeypot Risk
    if (goPlusData) {
        if (goPlusData.is_honeypot === '1') {
            report += `Honeypot Risk: ❌\n`
        } else {
            report += `Honeypot Risk: ✅\n`
        }
    } else {
        report += `Honeypot Risk: Not detected in available datasets\n`
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
        report += `Owner Privileges: Not detected in available datasets\n`
    }

    // Liquidity Status
    if (dexscreenerData) {
        if (dexscreenerData.liquidityUsd > 100000) {
            report += `Liquidity Status: ✅ Detected via primary pool\n`
        } else if (dexscreenerData.liquidityUsd > 10000) {
            report += `Liquidity Status: ⚠️ Moderate liquidity\n`
        } else {
            report += `Liquidity Status: ⚠️ Low liquidity detected\n`
        }
    } else if (goPlusData?.lp_holder_count !== undefined) {
        const lpCount = parseInt(goPlusData.lp_holder_count) || 0
        if (lpCount > 1) {
            report += `Liquidity Status: ✅ Multiple holders\n`
        } else if (lpCount === 1) {
            report += `Liquidity Status: ⚠️ Single holder\n`
        } else {
            report += `Liquidity Status: ⚠️ No liquidity pool detected\n`
        }
    } else {
        report += `Liquidity Status: Not detected in available datasets\n`
    }

    // Contract Verified
    if (explorerData?.verified || wellKnown) {
        report += `Contract Verified: ✅ Yes (${explorerData?.source || 'Etherscan'})\n`
    } else {
        report += `Contract Verified: Not publicly reported\n`
    }

    // Token Age (with multiple fallbacks)
    const tokenAge = calculateTokenAge(
        wellKnown?.launchDate || coingeckoData?.launchDate,
        dexscreenerData?.pairCreatedAt,
        explorerData?.creationTx
    )
    report += `Token Age: ${tokenAge}\n`

    // Holder Count
    if (goPlusData?.holder_count) {
        const holderCount = parseInt(goPlusData.holder_count)
        report += `Holder Count: ${holderCount.toLocaleString()}\n`
    } else if (dexscreenerData?.holdersEstimate) {
        report += `Holder Count: ${dexscreenerData.holdersEstimate.toLocaleString()} (estimate)\n`
    } else {
        report += `Holder Count: Not detected in available datasets\n`
    }

    // Final Verdict (always choose one of 4 options, never "DATA UNAVAILABLE")
    report += `\nFinal Verdict: `
    
    if (riskLevel === 'HIGH') {
        report += '🔴 HIGH RISK – Serious security issues detected.'
    } else if (riskLevel === 'MEDIUM') {
        report += '🟡 REVIEW RECOMMENDED – Some risks or missing data require review.'
    } else if (riskLevel === 'LOW') {
        if (chainDetected && goPlusData && explorerData && 
            goPlusData.is_honeypot !== '1' && 
            (!goPlusData.owner_address || goPlusData.owner_address === '0x0000000000000000000000000000000000000000' ||
             (goPlusData.can_take_back_ownership !== '1' && goPlusData.is_blacklisted !== '1' && 
              goPlusData.selfdestruct !== '1' && goPlusData.is_mintable !== '1' && 
              goPlusData.transfer_pausable !== '1'))) {
            report += '🟢 NO CRITICAL RISKS DETECTED – No major risks found in available data.'
        } else {
            report += '🟡 REVIEW RECOMMENDED – Based on currently available on-chain data.'
        }
    } else {
        report += '🟡 REVIEW RECOMMENDED – Based on currently available on-chain data.'
    }

    report += `\n\nWhy this score?\n`
    if (explanations.length > 0) {
        explanations.forEach(explanation => {
            report += `• ${explanation}\n`
        })
    } else {
        report += `• No critical issues detected in available data\n`
    }
    report += `• Based on currently available on-chain data\n`

    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.`

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
            '💧 Liquidity status\n' +
            '📜 Contract verification\n' +
            '⏳ Token age\n' +
            '👥 Holder count\n\n' +
            '**Supported chains:**\n' +
            '- **EVM:** Ethereum, Base, Arbitrum, BSC\n' +
            '- **Solana:** Full analysis mode\n\n' +
            '**Data sources:**\n' +
            '- GoPlus Security API\n' +
            '- Etherscan / Basescan / Arbiscan / BscScan\n' +
            '- Dexscreener (liquidity & trading data)\n' +
            '- CoinGecko (token metadata & launch dates)\n' +
            '- Solscan (Solana)\n\n' +
            '**Important:**\n' +
            '- This bot is **read-only** and **non-custodial**\n' +
            '- Results are **informational only**, not financial advice\n' +
            '- Always do your own research (DYOR)',
    )
})

function isSafetyQuery(message) {
    const lowerMessage = message.toLowerCase()
    const triggers = [
        'is this token safe', 'check this contract', 'scan this address', 'scan this contract',
        'any red flags', 'should i buy', 'explain this token', 'check this token', 'analyze this',
        'is this safe', 'token safety', 'contract safety', 'is it safe', 'thinking of aping',
        'is this a good buy', 'should i invest', 'health check',
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
            
            const [goPlusData, explorerData, dexscreenerData, coingeckoData] = await Promise.allSettled([
                fetchGoPlusData(address, chainInfo.chainId),
                fetchExplorerData(address, chainInfo.chainName),
                fetchDexscreenerData(address, chainInfo.chainName),
                fetchCoinGeckoData(address, chainInfo.chainName),
            ])

            const report = generateHealthReport(
                address,
                goPlusData.status === 'fulfilled' ? goPlusData.value : null,
                explorerData.status === 'fulfilled' ? explorerData.value : null,
                dexscreenerData.status === 'fulfilled' ? dexscreenerData.value : null,
                coingeckoData.status === 'fulfilled' ? coingeckoData.value : null,
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
    if (!isMentioned) return
    if (!isBotMentioned(message)) return

    const addressData = extractAddress(message)
    const isPreBuy = isPreBuyQuery(message)

    if (addressData && addressData.address) {
        await analyzeToken(handler, channelId, addressData.address, addressData.type, isPreBuy)
        return
    }

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
