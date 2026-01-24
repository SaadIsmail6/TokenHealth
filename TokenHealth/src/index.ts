import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands'

// ────────────────────────────────────────────────────────────────────────────────
// TOKENHEALTH v2.0 - PRODUCTION-GRADE BLOCKCHAIN SECURITY ANALYZER
// ────────────────────────────────────────────────────────────────────────────────
// Core Principle: SAFETY > ACCURACY > OPTIMISM
// False safe is WORSE than false danger
// ────────────────────────────────────────────────────────────────────────────────

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface DataConfidence {
    level: 'HIGH' | 'MEDIUM' | 'LOW'
    percentage: number
    successfulChecks: number
    totalChecks: number
    missingFields: string[]
}

interface SecurityFlags {
    honeypot: boolean
    mintAuthority: boolean
    freezeAuthority: boolean
    blacklistAuthority: boolean
    ownerPrivileges: boolean
    proxyUpgradeable: boolean
    unverifiedContract: boolean
    noLiquidity: boolean
    newToken: boolean
    notListed: boolean
}

interface TokenData {
    name: string
    symbol: string
    chain: string
    address: string
    tokenAge: number | null // in days
    pairAge: number | null // in days
    liquidity: number | null
    holderCount: number | null
    contractVerified: boolean | null
    marketCap: number | null
    cmcRank: number | null
    cmcListed: boolean
}

interface RiskAnalysis {
    healthScore: number
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    dataConfidence: DataConfidence
    securityFlags: SecurityFlags
    penalties: Array<{ reason: string; points: number }>
    verdict: string
    warnings: string[]
}

// ============================================================================
// WELL-KNOWN TOKENS (WHITELIST)
// ============================================================================

const WELL_KNOWN_TOKENS: Record<string, { name: string; symbol: string; age: number }> = {
    // Ethereum mainnet
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', age: 2500 },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', age: 2000 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', age: 2500 },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped Bitcoin', symbol: 'WBTC', age: 2000 },
    // Base
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', age: 500 },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { name: 'USD Coin', symbol: 'USDC', age: 500 },
    // Towns Protocol
    '0x000000fa00b200406de700041cfc6b19bbfb4d13': { name: 'Towns', symbol: 'TOWNS', age: 180 },
}

// ============================================================================
// API RETRY UTILITY
// ============================================================================

async function fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    retries: number = 2,
    delayMs: number = 1000
): Promise<T | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetchFn()
        } catch (error) {
            if (attempt === retries) {
                console.error('Fetch failed after retries:', error)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
        }
    }
    return null
}

// ============================================================================
// ADDRESS & CHAIN DETECTION
// ============================================================================

function detectAddressType(address: string): 'EVM' | 'SOLANA' | 'UNKNOWN' {
    // EVM: 0x followed by 40 hex characters
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return 'EVM'
    }
    
    // Solana: Base58 string, 32-44 characters, no 0, O, I, l
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && !address.startsWith('0x')) {
        return 'SOLANA'
    }
    
    return 'UNKNOWN'
}

async function detectEVMChain(address: string): Promise<string> {
    // Try GoPlus multi-chain detection
    try {
        const chains = ['eth', 'bsc', 'base', 'arbitrum', 'polygon', 'optimism']
        
        for (const chain of chains) {
            const response = await fetch(
                `https://api.gopluslabs.io/api/v1/token_security/${chain === 'eth' ? '1' : chain}?contract_addresses=${address}`
            )
            const data = await response.json()
            
            if (data.result && Object.keys(data.result).length > 0) {
                const chainNames: Record<string, string> = {
                    '1': 'Ethereum',
                    'eth': 'Ethereum',
                    'bsc': 'BSC',
                    'base': 'Base',
                    'arbitrum': 'Arbitrum',
                    'polygon': 'Polygon',
                    'optimism': 'Optimism'
                }
                return chainNames[chain] || 'Ethereum'
            }
        }
    } catch (error) {
        console.error('Chain detection failed:', error)
    }
    
    // Default to Ethereum for valid EVM addresses
    return 'Ethereum'
}

// ============================================================================
// API DATA FETCHERS
// ============================================================================

async function fetchGoPlusData(address: string, chain: string) {
    const chainMap: Record<string, string> = {
        'Ethereum': '1',
        'BSC': '56',
        'Base': '8453',
        'Arbitrum': '42161',
        'Polygon': '137',
        'Optimism': '10'
    }
    
    const chainId = chainMap[chain] || '1'
    
    return fetchWithRetry(async () => {
        const response = await fetch(
            `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`
        )
        if (!response.ok) throw new Error('GoPlus API failed')
        const data = await response.json()
        return data.result?.[address.toLowerCase()] || null
    })
}

async function fetchExplorerData(address: string, chain: string) {
    const explorerAPIs: Record<string, { url: string; key: string }> = {
        'Ethereum': { url: 'https://api.etherscan.io/api', key: process.env.ETHERSCAN_API_KEY || '' },
        'BSC': { url: 'https://api.bscscan.com/api', key: process.env.BSCSCAN_API_KEY || '' },
        'Base': { url: 'https://api.basescan.org/api', key: process.env.BASESCAN_API_KEY || '' },
        'Arbitrum': { url: 'https://api.arbiscan.io/api', key: process.env.ARBISCAN_API_KEY || '' },
        'Polygon': { url: 'https://api.polygonscan.com/api', key: process.env.POLYGONSCAN_API_KEY || '' },
    }
    
    const explorer = explorerAPIs[chain]
    if (!explorer || !explorer.key) return null
    
    return fetchWithRetry(async () => {
        // Get contract source (verification status)
        const sourceResponse = await fetch(
            `${explorer.url}?module=contract&action=getsourcecode&address=${address}&apikey=${explorer.key}`
        )
        const sourceData = await sourceResponse.json()
        
        // Get contract creation
        const creationResponse = await fetch(
            `${explorer.url}?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${explorer.key}`
        )
        const creationData = await creationResponse.json()
        
        return {
            verified: sourceData.result?.[0]?.SourceCode ? true : false,
            contractName: sourceData.result?.[0]?.ContractName || null,
            creationTx: creationData.result?.[0]?.txHash || null,
            creationBlock: creationData.result?.[0]?.blockNumber || null,
        }
    })
}

async function fetchDexscreenerData(address: string) {
    return fetchWithRetry(async () => {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
        if (!response.ok) throw new Error('Dexscreener API failed')
        const data = await response.json()
        
        if (!data.pairs || data.pairs.length === 0) return null
        
        // Get the most liquid pair
        const mainPair = data.pairs.sort((a: any, b: any) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        )[0]
        
        return {
            liquidity: mainPair.liquidity?.usd || null,
            pairAge: mainPair.pairCreatedAt ? 
                Math.floor((Date.now() - mainPair.pairCreatedAt) / (1000 * 60 * 60 * 24)) : null,
            txns24h: mainPair.txns?.h24 || null,
            volume24h: mainPair.volume?.h24 || null,
        }
    })
}

async function fetchSolscanData(address: string) {
    const apiKey = process.env.SOLSCAN_API_KEY
    if (!apiKey) return null
    
    return fetchWithRetry(async () => {
        const headers = { 'token': apiKey }
        
        // Get token metadata
        const metaResponse = await fetch(
            `https://pro-api.solscan.io/v1.0/token/meta?tokenAddress=${address}`,
            { headers }
        )
        const metadata = await metaResponse.json()
        
        // Get token holders
        const holderResponse = await fetch(
            `https://pro-api.solscan.io/v1.0/token/holders?tokenAddress=${address}&offset=0&limit=1`,
            { headers }
        )
        const holderData = await holderResponse.json()
        
        return {
            name: metadata.name || null,
            symbol: metadata.symbol || null,
            decimals: metadata.decimals || null,
            supply: metadata.supply || null,
            holderCount: holderData.total || null,
            mintAuthority: metadata.mintAuthority || null,
            freezeAuthority: metadata.freezeAuthority || null,
        }
    })
}

async function fetchCoinGeckoData(address: string, chain: string) {
    const platformMap: Record<string, string> = {
        'Ethereum': 'ethereum',
        'BSC': 'binance-smart-chain',
        'Base': 'base',
        'Arbitrum': 'arbitrum-one',
        'Polygon': 'polygon-pos',
    }
    
    const platform = platformMap[chain]
    if (!platform) return null
    
    return fetchWithRetry(async () => {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address}`
        )
        if (!response.ok) return null
        const data = await response.json()
        
        return {
            name: data.name || null,
            symbol: data.symbol || null,
            marketCap: data.market_data?.market_cap?.usd || null,
            genesisDate: data.genesis_date || null,
            cmcRank: data.market_cap_rank || null,
        }
    })
}

// ============================================================================
// TOKEN AGE CALCULATION
// ============================================================================

async function calculateTokenAge(
    address: string,
    chain: string,
    dexData: any,
    explorerData: any,
    cgData: any
): Promise<number | null> {
    // Check whitelist first
    const normalizedAddress = address.toLowerCase()
    if (WELL_KNOWN_TOKENS[normalizedAddress]) {
        return WELL_KNOWN_TOKENS[normalizedAddress].age
    }
    
    // Try CoinGecko genesis date
    if (cgData?.genesisDate) {
        const genesisTime = new Date(cgData.genesisDate).getTime()
        return Math.floor((Date.now() - genesisTime) / (1000 * 60 * 60 * 24))
    }
    
    // Try Dexscreener pair age
    if (dexData && dexData.pairAge !== null && dexData.pairAge !== undefined) {
        return dexData.pairAge
    }
    
    // Try explorer creation block (approximate)
    if (explorerData?.creationBlock) {
        // Rough estimate: assume 13s per block for Ethereum
        const blocksPerDay = (24 * 60 * 60) / 13
        const currentBlock = 20000000 // Approximate current block
        const daysOld = (currentBlock - explorerData.creationBlock) / blocksPerDay
        return Math.floor(daysOld)
    }
    
    return null
}

// ============================================================================
// DATA CONFIDENCE CALCULATOR
// ============================================================================

function calculateDataConfidence(
    tokenData: TokenData,
    goPlusData: any,
    explorerData: any,
    dexData: any,
    addressType: string
): DataConfidence {
    const checks = []
    const missing: string[] = []
    
    // Define critical checks based on chain type
    if (addressType === 'EVM') {
        checks.push({ field: 'Token Age', available: tokenData.tokenAge !== null })
        checks.push({ field: 'Liquidity', available: tokenData.liquidity !== null })
        checks.push({ field: 'Contract Verification', available: tokenData.contractVerified !== null })
        checks.push({ field: 'Holder Count', available: tokenData.holderCount !== null })
        checks.push({ field: 'Honeypot Check', available: goPlusData !== null })
        checks.push({ field: 'Owner Privileges', available: goPlusData !== null })
        checks.push({ field: 'Explorer Data', available: explorerData !== null })
    } else if (addressType === 'SOLANA') {
        checks.push({ field: 'Token Age', available: tokenData.tokenAge !== null })
        checks.push({ field: 'Liquidity', available: tokenData.liquidity !== null })
        checks.push({ field: 'Holder Count', available: tokenData.holderCount !== null })
        checks.push({ field: 'Mint Authority', available: dexData !== null })
        checks.push({ field: 'Freeze Authority', available: dexData !== null })
    }
    
    const successfulChecks = checks.filter(c => c.available).length
    const totalChecks = checks.length
    const percentage = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0
    
    checks.forEach(check => {
        if (!check.available) missing.push(check.field)
    })
    
    let level: 'HIGH' | 'MEDIUM' | 'LOW'
    if (percentage > 80) level = 'HIGH'
    else if (percentage >= 40) level = 'MEDIUM'
    else level = 'LOW'
    
    return {
        level,
        percentage: Math.round(percentage),
        successfulChecks,
        totalChecks,
        missingFields: missing
    }
}

// ============================================================================
// SECURITY FLAGS DETECTOR
// ============================================================================

function detectSecurityFlags(
    goPlusData: any,
    solscanData: any,
    explorerData: any,
    dexData: any,
    tokenAge: number | null,
    addressType: string
): SecurityFlags {
    return {
        honeypot: addressType === 'EVM' && (
            goPlusData?.is_honeypot === '1' ||
            goPlusData?.buy_tax > 50 ||
            goPlusData?.sell_tax > 50 ||
            goPlusData?.cannot_sell_all === '1'
        ),
        mintAuthority: addressType === 'SOLANA' && solscanData?.mintAuthority !== null && solscanData?.mintAuthority !== undefined,
        freezeAuthority: addressType === 'SOLANA' && solscanData?.freezeAuthority !== null && solscanData?.freezeAuthority !== undefined,
        blacklistAuthority: addressType === 'EVM' && goPlusData?.is_blacklisted === '1',
        ownerPrivileges: addressType === 'EVM' && (
            goPlusData?.owner_change_balance === '1' ||
            goPlusData?.hidden_owner === '1' ||
            goPlusData?.selfdestruct === '1'
        ),
        proxyUpgradeable: addressType === 'EVM' && goPlusData?.is_proxy === '1',
        unverifiedContract: addressType === 'EVM' && explorerData?.verified === false,
        noLiquidity: !dexData || dexData.liquidity === null || dexData.liquidity === undefined || dexData.liquidity < 1000,
        newToken: tokenAge !== null && tokenAge < 7,
        notListed: !dexData || dexData.liquidity === null || dexData.liquidity === undefined
    }
}

// ============================================================================
// SCORING ENGINE (REDESIGNED)
// ============================================================================

function calculateHealthScore(
    securityFlags: SecurityFlags,
    dataConfidence: DataConfidence,
    tokenAge: number | null,
    addressType: string
): { score: number; penalties: Array<{ reason: string; points: number }> } {
    let score = 100
    const penalties: Array<{ reason: string; points: number }> = []
    
    // CRITICAL FLAGS (immediate high risk)
    if (securityFlags.honeypot) {
        penalties.push({ reason: 'Honeypot behavior detected', points: 50 })
        score -= 50
    }
    
    if (securityFlags.mintAuthority) {
        penalties.push({ reason: 'Mint authority still active (supply inflation risk)', points: 30 })
        score -= 30
    }
    
    if (securityFlags.freezeAuthority) {
        penalties.push({ reason: 'Freeze authority active (can freeze wallets)', points: 25 })
        score -= 25
    }
    
    if (securityFlags.ownerPrivileges) {
        penalties.push({ reason: 'Dangerous owner privileges detected', points: 30 })
        score -= 30
    }
    
    // LIQUIDITY & AGE
    if (securityFlags.noLiquidity) {
        penalties.push({ reason: 'No liquidity detected or insufficient liquidity', points: 25 })
        score -= 25
    }
    
    if (tokenAge !== null && tokenAge < 1) {
        penalties.push({ reason: 'Extremely new token (<24 hours) - high rug risk', points: 35 })
        score -= 35
    } else if (tokenAge !== null && tokenAge < 7) {
        penalties.push({ reason: 'Very new token (<7 days) - elevated risk', points: 20 })
        score -= 20
    } else if (tokenAge === null) {
        penalties.push({ reason: 'Token age unknown - cannot verify launch date', points: 15 })
        score -= 15
    }
    
    // CONTRACT & VERIFICATION
    if (securityFlags.unverifiedContract) {
        penalties.push({ reason: 'Contract not verified on block explorer', points: 15 })
        score -= 15
    }
    
    if (securityFlags.proxyUpgradeable) {
        penalties.push({ reason: 'Upgradeable proxy contract (owner can change logic)', points: 10 })
        score -= 10
    }
    
    if (securityFlags.blacklistAuthority) {
        penalties.push({ reason: 'Blacklist function detected', points: 20 })
        score -= 20
    }
    
    // MARKET PRESENCE
    if (securityFlags.notListed) {
        penalties.push({ reason: 'Not listed on major DEXs or explorers', points: 15 })
        score -= 15
    }
    
    // DATA CONFIDENCE PENALTY
    if (dataConfidence.level === 'LOW') {
        penalties.push({ reason: 'Insufficient data to perform thorough analysis', points: 20 })
        score -= 20
    } else if (dataConfidence.level === 'MEDIUM') {
        penalties.push({ reason: 'Some critical data unavailable', points: 10 })
        score -= 10
    }
    
    // SOLANA LIMITED MODE
    if (addressType === 'SOLANA') {
        penalties.push({ reason: 'Solana security checks are limited', points: 15 })
        score -= 15
    }
    
    // Clamp score
    score = Math.max(0, Math.min(100, score))
    
    // OVERRIDE RULES: Missing data caps score
    if (dataConfidence.level === 'LOW') {
        score = Math.min(score, 55)
    } else if (dataConfidence.level === 'MEDIUM' && dataConfidence.percentage < 60) {
        score = Math.min(score, 60)
    }
    
    // New token caps
    if (tokenAge !== null && tokenAge < 1) {
        score = Math.min(score, 40)
    } else if (tokenAge !== null && tokenAge < 7) {
        score = Math.min(score, 65)
    }
    
    return { score, penalties }
}

// ============================================================================
// RISK LEVEL DETERMINATOR
// ============================================================================

function determineRiskLevel(
    score: number,
    securityFlags: SecurityFlags,
    dataConfidence: DataConfidence
): 'LOW' | 'MEDIUM' | 'HIGH' {
    // OVERRIDE RULES: Critical flags force HIGH risk
    if (securityFlags.honeypot || securityFlags.mintAuthority || securityFlags.ownerPrivileges) {
        return 'HIGH'
    }
    
    // Missing data forces at least MEDIUM
    if (dataConfidence.level === 'LOW') {
        return 'HIGH'
    }
    
    if (dataConfidence.level === 'MEDIUM' && score < 70) {
        return 'MEDIUM'
    }
    
    // Score-based mapping
    if (score >= 80) return 'LOW'
    if (score >= 60) return 'MEDIUM'
    return 'HIGH'
}

// ============================================================================
// VERDICT ENGINE (RULE-BASED)
// ============================================================================

function generateVerdict(
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
    securityFlags: SecurityFlags,
    dataConfidence: DataConfidence,
    tokenAge: number | null,
    addressType: string
): { verdict: string; warnings: string[] } {
    const warnings: string[] = []
    
    // CRITICAL ISSUES (specific verdicts)
    if (securityFlags.honeypot) {
        return {
            verdict: '🔴 HIGH RISK – Honeypot behavior detected. Do NOT interact.',
            warnings: ['This token may prevent you from selling after purchase']
        }
    }
    
    if (securityFlags.mintAuthority) {
        return {
            verdict: '🔴 HIGH RISK – Token supply can be inflated at any time.',
            warnings: ['Mint authority is still active - owner can print unlimited tokens']
        }
    }
    
    if (securityFlags.ownerPrivileges) {
        return {
            verdict: '🔴 HIGH RISK – Dangerous owner privileges detected.',
            warnings: ['Owner can modify balances or pause trading']
        }
    }
    
    // DATA QUALITY ISSUES
    if (dataConfidence.level === 'LOW') {
        return {
            verdict: '⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined.',
            warnings: [`Only ${dataConfidence.percentage}% of security checks could be performed`]
        }
    }
    
    // NEW TOKEN WARNINGS
    if (tokenAge !== null && tokenAge < 1) {
        warnings.push('🚨 VERY NEW TOKEN – Extremely high rug risk')
        warnings.push('Token created less than 24 hours ago')
        return {
            verdict: '🟡 EARLY-STAGE TOKEN – Launch-phase rug risk is extremely high.',
            warnings
        }
    }
    
    if (securityFlags.noLiquidity) {
        return {
            verdict: '🔴 HIGH RISK – No active liquidity pool detected.',
            warnings: ['Cannot verify market depth or trading history']
        }
    }
    
    // SOLANA LIMITED MODE
    if (addressType === 'SOLANA' && dataConfidence.level !== 'HIGH') {
        return {
            verdict: '⚠️ LIMITED SOLANA ANALYSIS – Manual review required.',
            warnings: ['Solana security features are limited compared to EVM chains']
        }
    }
    
    // GENERAL RISK LEVELS
    if (riskLevel === 'HIGH') {
        return {
            verdict: '🔴 HIGH RISK – Multiple risk factors detected.',
            warnings: ['Proceed with extreme caution or avoid entirely']
        }
    }
    
    if (riskLevel === 'MEDIUM') {
        const mediumWarnings = []
        if (securityFlags.newToken) mediumWarnings.push('Token is less than 7 days old')
        if (securityFlags.unverifiedContract) mediumWarnings.push('Contract not verified')
        if (dataConfidence.level === 'MEDIUM') mediumWarnings.push('Some security data unavailable')
        
        return {
            verdict: '⚠️ REVIEW RECOMMENDED – Some risk factors or limited history detected.',
            warnings: mediumWarnings
        }
    }
    
    // LOW RISK - only if all conditions are met
    if (
        dataConfidence.level === 'HIGH' &&
        !securityFlags.honeypot &&
        !securityFlags.mintAuthority &&
        !securityFlags.ownerPrivileges &&
        !securityFlags.noLiquidity &&
        tokenAge !== null &&
        tokenAge >= 7
    ) {
        return {
            verdict: '🟢 NO CRITICAL RISKS DETECTED – Token appears relatively safe.',
            warnings: ['Always DYOR - this is not financial advice']
        }
    }
    
    // Fallback
    return {
        verdict: '⚠️ REVIEW RECOMMENDED – Unable to fully assess risk.',
        warnings: ['Incomplete analysis - exercise caution']
    }
}

// ============================================================================
// REPORT GENERATOR
// ============================================================================

function generateReport(
    tokenData: TokenData,
    analysis: RiskAnalysis,
    addressType: string
): string {
    let report = '🩺 TokenHealth Report\n\n'
    
    // Token Info
    report += `Token: ${tokenData.name || 'Unknown'}\n`
    report += `Symbol: ${tokenData.symbol || 'Unknown'}\n`
    report += `Chain: ${tokenData.chain}\n`
    report += `Address: \`${tokenData.address}\`\n\n`
    
    // Health Score & Risk
    const riskEmoji = {
        'HIGH': '🔴',
        'MEDIUM': '⚠️',
        'LOW': '🟢'
    }
    
    report += `Health Score: ${analysis.healthScore}/100\n`
    report += `Risk Level: ${riskEmoji[analysis.riskLevel]} ${analysis.riskLevel}\n`
    report += `Data Confidence: ${analysis.dataConfidence.level} (${analysis.dataConfidence.percentage}%)\n\n`
    
    // Security Checks
    report += '─────────── Security Checks ───────────\n\n'
    
    if (addressType === 'EVM') {
        report += `Honeypot Risk: ${analysis.securityFlags.honeypot ? '🔴 DETECTED' : '✅ None detected'}\n`
        report += `Owner Privileges: ${analysis.securityFlags.ownerPrivileges ? '🔴 DANGEROUS' : '✅ Safe'}\n`
        report += `Blacklist Function: ${analysis.securityFlags.blacklistAuthority ? '⚠️ Present' : '✅ None'}\n`
        report += `Contract Verified: ${tokenData.contractVerified === true ? '✅ Yes' : tokenData.contractVerified === false ? '⚠️ No' : '⚠️ Unknown'}\n`
        report += `Proxy Upgradeable: ${analysis.securityFlags.proxyUpgradeable ? '⚠️ Yes' : '✅ No'}\n`
    } else if (addressType === 'SOLANA') {
        report += `Mint Authority: ${analysis.securityFlags.mintAuthority ? '🔴 ACTIVE' : '✅ Disabled'}\n`
        report += `Freeze Authority: ${analysis.securityFlags.freezeAuthority ? '⚠️ ACTIVE' : '✅ Disabled'}\n`
        report += `Honeypot Risk: ⚠️ Not supported on Solana\n`
        report += `Contract Verified: ⚠️ Not applicable on Solana\n`
    }
    
    // Market Data
    report += `\nLiquidity: ${tokenData.liquidity ? `$${tokenData.liquidity.toLocaleString()}` : '⚠️ No pool detected'}\n`
    
    if (tokenData.tokenAge !== null) {
        if (tokenData.tokenAge < 1) {
            report += `Token Age: 🆕 Just created (minutes/hours ago)\n`
        } else if (tokenData.tokenAge < 7) {
            report += `Token Age: 🆕 ${tokenData.tokenAge} day${tokenData.tokenAge > 1 ? 's' : ''} (very new)\n`
        } else {
            report += `Token Age: ${tokenData.tokenAge} days\n`
        }
    } else {
        report += `Token Age: ⚠️ Age unavailable (treat as high risk)\n`
    }
    
    report += `Holder Count: ${tokenData.holderCount !== null ? tokenData.holderCount.toLocaleString() : '⚠️ Data unavailable'}\n`
    
    if (tokenData.cmcListed) {
        report += `CMC Listing: ✅ Listed`
        if (tokenData.cmcRank) report += ` (Rank #${tokenData.cmcRank})`
        report += '\n'
    }
    
    // Missing Data Warning
    if (analysis.dataConfidence.missingFields.length > 0) {
        report += `\n⚠️ Missing / Unavailable Data:\n`
        analysis.dataConfidence.missingFields.forEach(field => {
            report += `  • ${field}\n`
        })
    }
    
    // Verdict
    report += `\n─────────── Final Verdict ───────────\n\n`
    report += `${analysis.verdict}\n`
    
    // Warnings
    if (analysis.warnings.length > 0) {
        report += `\n`
        analysis.warnings.forEach(warning => {
            report += `⚠️ ${warning}\n`
        })
    }
    
    // Penalties Breakdown
    if (analysis.penalties.length > 0) {
        report += `\n─────────── Why this score? ───────────\n\n`
        analysis.penalties.forEach(penalty => {
            report += `• ${penalty.reason} (−${penalty.points} points)\n`
        })
    }
    
    // Footer
    report += `\nNot financial advice. TokenHealth provides automated risk analysis only. Always DYOR.\n`
    report += `TokenHealth provides information only and does not facilitate trading or gambling.`
    
    return report
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

async function analyzeToken(address: string): Promise<string> {
    // Detect address type
    const addressType = detectAddressType(address)
    
    if (addressType === 'UNKNOWN') {
        return '⚠️ UNSUPPORTED ADDRESS FORMAT\n\n' +
               'Unable to identify if this is an EVM or Solana address.\n' +
               'Please provide a valid token contract address.'
    }
    
    try {
        let tokenData: TokenData
        let goPlusData: any = null
        let explorerData: any = null
        let dexData: any = null
        let solscanData: any = null
        let cgData: any = null
        
        // EVM ANALYSIS
        if (addressType === 'EVM') {
            const chain = await detectEVMChain(address)
            
            // Fetch all data in parallel
            const [goPlus, explorer, dex, cg] = await Promise.all([
                fetchGoPlusData(address, chain),
                fetchExplorerData(address, chain),
                fetchDexscreenerData(address),
                fetchCoinGeckoData(address, chain)
            ])
            
            goPlusData = goPlus
            explorerData = explorer
            dexData = dex
            cgData = cg
            
            const tokenAge = await calculateTokenAge(address, chain, dexData, explorerData, cgData)
            
            tokenData = {
                name: cgData?.name || goPlusData?.token_name || 'Unknown',
                symbol: cgData?.symbol || goPlusData?.token_symbol || 'Unknown',
                chain,
                address,
                tokenAge,
                pairAge: dexData?.pairAge || null,
                liquidity: dexData?.liquidity || null,
                holderCount: goPlusData?.holder_count ? parseInt(goPlusData.holder_count) : null,
                contractVerified: explorerData?.verified || null,
                marketCap: cgData?.marketCap || null,
                cmcRank: cgData?.cmcRank || null,
                cmcListed: !!cgData
            }
        }
        // SOLANA ANALYSIS
        else {
            const [solscan, dex] = await Promise.all([
                fetchSolscanData(address),
                fetchDexscreenerData(address)
            ])
            
            solscanData = solscan
            dexData = dex
            
            // Calculate Solana token age (approximate from creation slot)
            let tokenAge: number | null = null
            if (dexData?.pairAge !== null) {
                tokenAge = dexData.pairAge
            }
            
            tokenData = {
                name: solscanData?.name || 'Unknown',
                symbol: solscanData?.symbol || 'Unknown',
                chain: 'Solana',
                address,
                tokenAge,
                pairAge: dexData?.pairAge || null,
                liquidity: dexData?.liquidity || null,
                holderCount: solscanData?.holderCount || null,
                contractVerified: null, // N/A for Solana
                marketCap: null,
                cmcRank: null,
                cmcListed: false
            }
        }
        
        // Calculate data confidence
        const dataConfidence = calculateDataConfidence(
            tokenData,
            goPlusData,
            explorerData,
            dexData,
            addressType
        )
        
        // Detect security flags
        const securityFlags = detectSecurityFlags(
            goPlusData,
            solscanData,
            explorerData,
            dexData,
            tokenData.tokenAge,
            addressType
        )
        
        // Calculate score
        const { score, penalties } = calculateHealthScore(
            securityFlags,
            dataConfidence,
            tokenData.tokenAge,
            addressType
        )
        
        // Determine risk level
        const riskLevel = determineRiskLevel(score, securityFlags, dataConfidence)
        
        // Generate verdict
        const { verdict, warnings } = generateVerdict(
            riskLevel,
            securityFlags,
            dataConfidence,
            tokenData.tokenAge,
            addressType
        )
        
        // Build analysis
        const analysis: RiskAnalysis = {
            healthScore: score,
            riskLevel,
            dataConfidence,
            securityFlags,
            penalties,
            verdict,
            warnings
        }
        
        // Generate report
        return generateReport(tokenData, analysis, addressType)
        
    } catch (error) {
        console.error('Analysis error:', error)
        return '🔴 ANALYSIS ERROR\n\n' +
               'Unable to complete security analysis due to technical issues.\n' +
               'Treat this token as HIGH RISK until verified manually.\n\n' +
               `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
}

// ============================================================================
// BOT SETUP & HANDLERS
// ============================================================================

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

// Help command
bot.onSlashCommand('help', async (handler, event) => {
    const helpMessage = `🩺 **TokenHealth v2.0** - Production Security Analyzer

**What it does:**
TokenHealth is a blockchain security assistant that analyzes tokens for safety risks. It checks honeypots, owner privileges, liquidity, contract verification, and more.

**Supported chains:**
• EVM: Ethereum, BSC, Base, Arbitrum, Polygon, Optimism
• Solana: Limited analysis (no honeypot detection)

**How to use:**
\`/health <address>\` - Analyze any token contract address
Or just mention me with an address!

**Safety Features:**
✅ Multi-source data verification
✅ Honeypot detection (EVM)
✅ Owner privilege scanning
✅ Liquidity & age verification
✅ Data confidence scoring
✅ Safety-first approach

**Important:**
🔴 This is informational only - NOT financial advice
🔴 Read-only analysis - no trading or wallet access
🔴 Always DYOR before interacting with any token

**Principles:**
• Missing data = Higher risk (never lower)
• False safe is worse than false danger
• When uncertain, we warn more

TokenHealth prioritizes your safety over optimism.`

    await handler.sendMessage(event.channelId, helpMessage)
})

// Health command
bot.onSlashCommand('health', async (handler, event) => {
    // args is an array - join them to get the full address/query
    const query = (event.args || []).join(' ').trim()
    
    if (!query) {
        await handler.sendMessage(
            event.channelId,
            '⚠️ Please provide a token address to analyze.\n\nUsage: `/health <address>`'
        )
        return
    }
    
    // Send analyzing message
    await handler.sendMessage(event.channelId, '🔍 Analyzing token... This may take a few seconds.')
    
    const report = await analyzeToken(query)
    await handler.sendMessage(event.channelId, report)
})

// Natural language detection
bot.onMessage(async (handler, event) => {
    const message = event.message.text.toLowerCase()
    
    // Check if bot is mentioned or safety query
    const mentionedBot = message.includes('tokenhealth')
    const isSafetyQuery = /is (this|it) safe|check (this|it)|scan (this|it)|analyze (this|it)/i.test(message)
    
    if (!mentionedBot && !isSafetyQuery) return
    
    // Extract address (0x... or base58)
    const evmMatch = message.match(/0x[a-fA-F0-9]{40}/)
    const solanaMatch = message.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)
    
    const address = evmMatch?.[0] || solanaMatch?.[0]
    
    if (!address) {
        await handler.sendMessage(
            event.channelId,
            'Please provide a token address to analyze. Use `/help` for more info.'
        )
        return
    }
    
    await handler.sendMessage(event.channelId, '🔍 Analyzing token...')
    const report = await analyzeToken(address)
    await handler.sendMessage(event.channelId, report)
})

// ============================================================================
// SERVER EXPORT
// ============================================================================

const app = bot.start()

// Health checks for Render
app.get('/', async (c) => {
    if (c.req.method === 'HEAD') {
        return c.text('', 200)
    }
    return c.json({ 
        status: 'ok', 
        service: 'TokenHealth Bot v2.0',
        version: '2.0.0'
    })
})

app.get('/health', async (c) => {
    return c.json({ 
        status: 'ok', 
        service: 'TokenHealth Bot v2.0',
        endpoints: {
            webhook: '/webhook',
            discovery: '/.well-known/agent-metadata.json',
            health: '/health'
        }
    })
})

app.get('/.well-known/agent-metadata.json', async (c) => {
    return c.json(await bot.getIdentityMetadata())
})

export default app

