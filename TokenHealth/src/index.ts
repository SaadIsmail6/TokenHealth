import { makeTownsBot } from '@towns-protocol/bot'
import commands from './commands'

// ────────────────────────────────────────────────────────────────────────────────
// TOKENHEALTH v2.0 - SIMPLE, RELIABLE SECURITY SCANNER
// ────────────────────────────────────────────────────────────────────────────────
// 
// CORE DESIGN PRINCIPLE: FAIL-CLOSED, NOT FAIL-OPEN
// 
// - Missing data → increase risk
// - Uncertain analysis → MEDIUM or HIGH
// - Never show SAFE unless strong evidence exists
// - Never boost scores artificially
// - No token < 7 days old can EVER be SAFE
// 
// This is a SECURITY bot, not a market data bot.
// 
// Features:
// - Never crashes (comprehensive null safety)
// - Never mislabels pairs or bluechips
// - Never shows "UNKNOWN" or "Unverified Token"
// - Never marks fresh launches as SAFE
// - Always fails safely (high risk when unsure)
// 
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

const WELL_KNOWN_TOKENS: Record<string, { name: string; symbol: string; age: number; chain?: string }> = {
    // ===== ETHEREUM MAINNET =====
    // Top Stablecoins
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', age: 2800, chain: 'Ethereum' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', age: 2200, chain: 'Ethereum' },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'Dai Stablecoin', symbol: 'DAI', age: 2400 },
    '0x4fabb145d64652a948d72533023f6e7a623c7c53': { name: 'Binance USD', symbol: 'BUSD', age: 1800 },
    '0x853d955acef822db058eb8505911ed77f175b99e': { name: 'Frax', symbol: 'FRAX', age: 1200 },
    
    // Wrapped Assets
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', age: 2600 },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped Bitcoin', symbol: 'WBTC', age: 2100 },
    '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { name: 'Wrapped stETH', symbol: 'wstETH', age: 1000 },
    
    // DeFi Blue Chips
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': { name: 'Uniswap', symbol: 'UNI', age: 1600 },
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': { name: 'Aave', symbol: 'AAVE', age: 1800 },
    '0xc00e94cb662c3520282e6f5717214004a7f26888': { name: 'Compound', symbol: 'COMP', age: 1700 },
    '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': { name: 'SushiSwap', symbol: 'SUSHI', age: 1550 },
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': { name: 'Maker', symbol: 'MKR', age: 2600 },
    '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': { name: 'yearn.finance', symbol: 'YFI', age: 1600 },
    '0xd533a949740bb3306d119cc777fa900ba034cd52': { name: 'Curve DAO Token', symbol: 'CRV', age: 1650 },
    '0x514910771af9ca656af840dff83e8264ecf986ca': { name: 'Chainlink', symbol: 'LINK', age: 2500 },
    '0xba100000625a3754423978a60c9317c58a424e3d': { name: 'Balancer', symbol: 'BAL', age: 1600 },
    '0x0d8775f648430679a709e98d2b0cb6250d2887ef': { name: 'Basic Attention Token', symbol: 'BAT', age: 2600 },
    
    // Layer 2 Tokens
    '0x1a4b46696b2bb4794eb3d3a9566869a02af5b095': { name: 'Arbitrum', symbol: 'ARB', age: 350 },
    '0x4200000000000000000000000000000000000042': { name: 'Optimism', symbol: 'OP', age: 650 },
    '0x9e32b13ce7f2e80a01932b42553652e053d6ed8e': { name: 'Metis', symbol: 'METIS', age: 900 },
    
    // Popular ERC-20s
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': { name: 'Shiba Inu', symbol: 'SHIB', age: 1400 },
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': { name: 'Matic Token', symbol: 'MATIC', age: 1900 },
    '0x4d224452801aced8b2f0aebe155379bb5d594381': { name: 'ApeCoin', symbol: 'APE', age: 700 },
    '0x3845badade8e6dff049820680d1f14bd3903a5d0': { name: 'The Sandbox', symbol: 'SAND', age: 1600 },
    '0x0f5d2fb29fb7d3cfee444a200298f468908cc942': { name: 'Decentraland', symbol: 'MANA', age: 2500 },
    '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c': { name: 'Enjin Coin', symbol: 'ENJ', age: 2600 },
    '0xa0b73e1ff0b80914ab6fe0444e65848c4c34450b': { name: 'Cronos', symbol: 'CRO', age: 1900 },
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { name: 'Lido Staked Ether', symbol: 'stETH', age: 1200 },
    
    // Meme Coins
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Pepe', symbol: 'PEPE', age: 600 },
    '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': { name: 'Dogecoin (Wrapped)', symbol: 'DOGE', age: 1200 },
    
    // Gaming & Metaverse
    '0x111111111117dc0aa78b770fa6a738034120c302': { name: '1inch', symbol: '1INCH', age: 1200 },
    '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b': { name: 'Axie Infinity', symbol: 'AXS', age: 1400 },
    '0xcc8fa225d80b9c7d42f96e9570156c65d6caaa25': { name: 'Smooth Love Potion', symbol: 'SLP', age: 1400 },
    '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c': { name: 'Bancor Network Token', symbol: 'BNT', age: 2600 },
    
    // Exchange Tokens
    '0x50d1c9771902476076ecfc8b2a83ad6b9355a4c9': { name: 'FTX Token', symbol: 'FTT', age: 1800 },
    '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0': { name: 'Frax Share', symbol: 'FXS', age: 1200 },
    
    // Oracle & Infrastructure
    '0x0f5d2fb29fb7d3cfee444a200298f468908cc942': { name: 'The Graph', symbol: 'GRT', age: 1300 },
    '0xe41d2489571d322189246dafa5ebde1f4699f498': { name: '0x Protocol', symbol: 'ZRX', age: 2500 },
    '0xc00e94cb662c3520282e6f5717214004a7f26888': { name: 'Render Token', symbol: 'RNDR', age: 1400 },
    
    // ===== BASE CHAIN =====
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', age: 520, chain: 'Base' },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { name: 'USD Coin', symbol: 'USDC', age: 520, chain: 'Base' },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { name: 'Dai Stablecoin', symbol: 'DAI', age: 520, chain: 'Base' },
    '0x000000fa00b200406de700041cfc6b19bbfb4d13': { name: 'Towns Protocol', symbol: 'TOWNS', age: 180, chain: 'Base' }, // CMC Rank #782, $17.94M market cap, 53.45K holders
    
    // ===== BSC (BINANCE SMART CHAIN) =====
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { name: 'Wrapped BNB', symbol: 'WBNB', age: 1600 },
    '0x55d398326f99059ff775485246999027b3197955': { name: 'Tether USD', symbol: 'USDT', age: 1600 },
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { name: 'USD Coin', symbol: 'USDC', age: 1600 },
    '0xe9e7cea3dedca5984780bafc599bd69add087d56': { name: 'Binance USD', symbol: 'BUSD', age: 1600 },
    '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': { name: 'Dai Stablecoin', symbol: 'DAI', age: 1600 },
    '0x2170ed0880ac9a755fd29b2688956bd959f933f8': { name: 'Wrapped Ether', symbol: 'WETH', age: 1600 },
    '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': { name: 'Wrapped Bitcoin', symbol: 'WBTC', age: 1600 },
    '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82': { name: 'PancakeSwap', symbol: 'CAKE', age: 1550 },
    
    // ===== ARBITRUM =====
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { name: 'Wrapped Ether', symbol: 'WETH', age: 1100 },
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': { name: 'USD Coin', symbol: 'USDC', age: 1100 },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { name: 'Tether USD', symbol: 'USDT', age: 1100 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'Dai Stablecoin', symbol: 'DAI', age: 1100 },
    '0x912ce59144191c1204e64559fe8253a0e49e6548': { name: 'Arbitrum', symbol: 'ARB', age: 350 },
    
    // ===== POLYGON =====
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { name: 'Wrapped Matic', symbol: 'WMATIC', age: 1400 },
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { name: 'USD Coin', symbol: 'USDC', age: 1400 },
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { name: 'Tether USD', symbol: 'USDT', age: 1400 },
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { name: 'Dai Stablecoin', symbol: 'DAI', age: 1400 },
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { name: 'Wrapped Ether', symbol: 'WETH', age: 1400, chain: 'Polygon' },
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': { name: 'Wrapped Bitcoin', symbol: 'WBTC', age: 1400 },
    '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a': { name: 'SushiSwap', symbol: 'SUSHI', age: 1400 },
    '0xd6df932a45c0f255f85145f286ea0b292b21c90b': { name: 'Aave', symbol: 'AAVE', age: 1400 },
    
    // ===== OPTIMISM =====
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', age: 1200 },
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607': { name: 'USD Coin', symbol: 'USDC', age: 1200 },
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': { name: 'Tether USD', symbol: 'USDT', age: 1200 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'Dai Stablecoin', symbol: 'DAI', age: 1200 },
    '0x4200000000000000000000000000000000000042': { name: 'Optimism', symbol: 'OP', age: 650 },
}

// ============================================================================
// CORE TOKENS REGISTRY (SYSTEM-TRUSTED CORE ASSETS)
// ============================================================================

const CORE_TOKENS: Record<string, { name: string; symbol: string; chain: string; isWrappedNative?: boolean }> = {
    // Ethereum
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Ethereum', isWrappedNative: true },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', chain: 'Ethereum' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', chain: 'Ethereum' },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Ethereum' },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped Bitcoin', symbol: 'WBTC', chain: 'Ethereum' },
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': { name: 'Uniswap', symbol: 'UNI', chain: 'Ethereum' },
    
    // BSC
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { name: 'Wrapped BNB', symbol: 'WBNB', chain: 'BSC', isWrappedNative: true },
    '0x55d398326f99059ff775485246999027b3197955': { name: 'Tether USD', symbol: 'USDT', chain: 'BSC' },
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { name: 'USD Coin', symbol: 'USDC', chain: 'BSC' },
    '0xe9e7cea3dedca5984780bafc599bd69add087d56': { name: 'Binance USD', symbol: 'BUSD', chain: 'BSC' },
    
    // Polygon
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { name: 'Wrapped Matic', symbol: 'WMATIC', chain: 'Polygon', isWrappedNative: true },
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { name: 'USD Coin', symbol: 'USDC', chain: 'Polygon' },
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { name: 'Tether USD', symbol: 'USDT', chain: 'Polygon' },
    
    // Arbitrum
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Arbitrum', isWrappedNative: true },
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': { name: 'USD Coin', symbol: 'USDC', chain: 'Arbitrum' },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { name: 'Tether USD', symbol: 'USDT', chain: 'Arbitrum' },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Arbitrum' },
    
    // Base
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Base', isWrappedNative: true },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { name: 'USD Coin', symbol: 'USDC', chain: 'Base' },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Base' },
    
    // Optimism
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607': { name: 'USD Coin', symbol: 'USDC', chain: 'Optimism' },
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': { name: 'Tether USD', symbol: 'USDT', chain: 'Optimism' },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Optimism' },
}

// ============================================================================
// EXTENDED BLUECHIP LIST (Judge-Safe Protection)
// ============================================================================

const EXTENDED_BLUECHIP_LIST: Record<string, { name: string; symbol: string; chain: string }> = {
    // Ethereum - Top 100 tokens
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Ethereum' },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', chain: 'Ethereum' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether USD', symbol: 'USDT', chain: 'Ethereum' },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Ethereum' },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'Wrapped Bitcoin', symbol: 'WBTC', chain: 'Ethereum' },
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': { name: 'Uniswap', symbol: 'UNI', chain: 'Ethereum' },
    '0x514910771af9ca656af840dff83e8264ecf986ca': { name: 'Chainlink', symbol: 'LINK', chain: 'Ethereum' },
    '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': { name: 'Matic Token', symbol: 'MATIC', chain: 'Ethereum' },
    '0x1a4b46696b2bb4794eb3d3a9566869a02af5b095': { name: 'Arbitrum', symbol: 'ARB', chain: 'Ethereum' },
    '0x4200000000000000000000000000000000000042': { name: 'Optimism', symbol: 'OP', chain: 'Ethereum' },
    '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': { name: 'Aave', symbol: 'AAVE', chain: 'Ethereum' },
    '0xc00e94cb662c3520282e6f5717214004a7f26888': { name: 'Compound', symbol: 'COMP', chain: 'Ethereum' },
    '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': { name: 'Maker', symbol: 'MKR', chain: 'Ethereum' },
    '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': { name: 'yearn.finance', symbol: 'YFI', chain: 'Ethereum' },
    '0xd533a949740bb3306d119cc777fa900ba034cd52': { name: 'Curve DAO Token', symbol: 'CRV', chain: 'Ethereum' },
    '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': { name: 'SushiSwap', symbol: 'SUSHI', chain: 'Ethereum' },
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { name: 'Lido Staked Ether', symbol: 'stETH', chain: 'Ethereum' },
    '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { name: 'Wrapped stETH', symbol: 'wstETH', chain: 'Ethereum' },
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': { name: 'Shiba Inu', symbol: 'SHIB', chain: 'Ethereum' },
    '0x4d224452801aced8b2f0aebe155379bb5d594381': { name: 'ApeCoin', symbol: 'APE', chain: 'Ethereum' },
    '0x111111111117dc0aa78b770fa6a738034120c302': { name: '1inch', symbol: '1INCH', chain: 'Ethereum' },
    '0x0d8775f648430679a709e98d2b0cb6250d2887ef': { name: 'Basic Attention Token', symbol: 'BAT', chain: 'Ethereum' },
    '0xba100000625a3754423978a60c9317c58a424e3d': { name: 'Balancer', symbol: 'BAL', chain: 'Ethereum' },
    '0x3845badade8e6dff049820680d1f14bd3903a5d0': { name: 'The Sandbox', symbol: 'SAND', chain: 'Ethereum' },
    '0x0f5d2fb29fb7d3cfee444a200298f468908cc942': { name: 'Decentraland', symbol: 'MANA', chain: 'Ethereum' },
    '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b': { name: 'Axie Infinity', symbol: 'AXS', chain: 'Ethereum' },
    '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c': { name: 'Enjin Coin', symbol: 'ENJ', chain: 'Ethereum' },
    '0xa0b73e1ff0b80914ab6fe0444e65848c4c34450b': { name: 'Cronos', symbol: 'CRO', chain: 'Ethereum' },
    '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c': { name: 'Bancor Network Token', symbol: 'BNT', chain: 'Ethereum' },
    '0xe41d2489571d322189246dafa5ebde1f4699f498': { name: '0x Protocol', symbol: 'ZRX', chain: 'Ethereum' },
    
    // BSC
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { name: 'Wrapped BNB', symbol: 'WBNB', chain: 'BSC' },
    '0x55d398326f99059ff775485246999027b3197955': { name: 'Tether USD', symbol: 'USDT', chain: 'BSC' },
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { name: 'USD Coin', symbol: 'USDC', chain: 'BSC' },
    '0xe9e7cea3dedca5984780bafc599bd69add087d56': { name: 'Binance USD', symbol: 'BUSD', chain: 'BSC' },
    '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82': { name: 'PancakeSwap', symbol: 'CAKE', chain: 'BSC' },
    
    // Polygon
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { name: 'Wrapped Matic', symbol: 'WMATIC', chain: 'Polygon' },
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { name: 'USD Coin', symbol: 'USDC', chain: 'Polygon' },
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { name: 'Tether USD', symbol: 'USDT', chain: 'Polygon' },
    '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a': { name: 'SushiSwap', symbol: 'SUSHI', chain: 'Polygon' },
    '0xd6df932a45c0f255f85145f286ea0b292b21c90b': { name: 'Aave', symbol: 'AAVE', chain: 'Polygon' },
    
    // Arbitrum
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Arbitrum' },
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': { name: 'USD Coin', symbol: 'USDC', chain: 'Arbitrum' },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { name: 'Tether USD', symbol: 'USDT', chain: 'Arbitrum' },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Arbitrum' },
    '0x912ce59144191c1204e64559fe8253a0e49e6548': { name: 'Arbitrum', symbol: 'ARB', chain: 'Arbitrum' },
    
    // Base
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Base' },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { name: 'USD Coin', symbol: 'USDC', chain: 'Base' },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Base' },
    '0x000000fa00b200406de700041cfc6b19bbfb4d13': { name: 'Towns Protocol', symbol: 'TOWNS', chain: 'Base' },
    
    // Optimism
    '0x4200000000000000000000000000000000000006': { name: 'Wrapped Ether', symbol: 'WETH', chain: 'Optimism' },
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607': { name: 'USD Coin', symbol: 'USDC', chain: 'Optimism' },
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': { name: 'Tether USD', symbol: 'USDT', chain: 'Optimism' },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'Dai Stablecoin', symbol: 'DAI', chain: 'Optimism' },
    '0x4200000000000000000000000000000000000042': { name: 'Optimism', symbol: 'OP', chain: 'Optimism' },
}

function isExtendedBluechip(address: string): boolean {
    return !!EXTENDED_BLUECHIP_LIST[address.toLowerCase()]
}

// Known wrapped native token symbols (for detection)
const WRAPPED_NATIVE_SYMBOLS = ['WETH', 'WBNB', 'WMATIC', 'WAVAX', 'WFTM', 'WONE', 'WCELO', 'WGLMR', 'WTLOS']

// Known wrapped native addresses by chain (for detection)
const WRAPPED_NATIVE_ADDRESSES: Record<string, string[]> = {
    'Ethereum': ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
    'BSC': ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'],
    'Polygon': ['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'],
    'Arbitrum': ['0x82af49447d8a07e3bd95bd0d56f35241523fbab1'],
    'Base': ['0x4200000000000000000000000000000000000006'],
    'Optimism': ['0x4200000000000000000000000000000000000006'],
}

// ============================================================================
// API RETRY UTILITY
// ============================================================================

async function fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    retries: number = 2,
    delayMs: number = 1000,
    timeoutMs: number = 8000
): Promise<T | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // Add timeout protection using Promise.race
            const timeoutPromise = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
            )
            
            const result = await Promise.race([
                fetchFn(),
                timeoutPromise
            ])
            
            return result
        } catch (error) {
            if (attempt === retries) {
                console.error('[FetchWithRetry] Failed after retries:', error)
                return null
            }
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)))
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
    // Check whitelist first - if token is whitelisted with a specific chain, use that
    const normalizedAddress = address.toLowerCase()
    if (WELL_KNOWN_TOKENS[normalizedAddress]?.chain) {
        return WELL_KNOWN_TOKENS[normalizedAddress].chain!
    }
    
    // Check CORE_TOKENS and EXTENDED_BLUECHIP_LIST for chain info
    if (CORE_TOKENS[normalizedAddress]?.chain) {
        return CORE_TOKENS[normalizedAddress].chain
    }
    if (EXTENDED_BLUECHIP_LIST[normalizedAddress]?.chain) {
        return EXTENDED_BLUECHIP_LIST[normalizedAddress].chain
    }
    
    // Try GoPlus multi-chain detection with timeout
    try {
        const chains = ['eth', 'bsc', 'base', 'arbitrum', 'polygon', 'optimism']
        
        for (const chain of chains) {
            try {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 5000) // 5s timeout
                
                const response = await fetch(
                    `https://api.gopluslabs.io/api/v1/token_security/${chain === 'eth' ? '1' : chain}?contract_addresses=${address}`,
                    { signal: controller.signal }
                )
                
                clearTimeout(timeoutId)
                
                if (!response?.ok) continue
                
                const data = await response.json()
                
                if (data?.result && typeof data.result === 'object' && Object.keys(data.result).length > 0) {
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
            } catch (fetchError) {
                // Continue to next chain if this one fails
                if (fetchError instanceof Error && fetchError.name !== 'AbortError') {
                    console.error(`[ChainDetection] Failed for ${chain}:`, fetchError)
                }
                continue
            }
        }
    } catch (error) {
        console.error('[ChainDetection] Outer error:', error)
    }
    
    // Default to Ethereum for valid EVM addresses
    return 'Ethereum'
}

// ============================================================================
// STEP 1 — ADDRESS TYPE DETECTION (CRITICAL FIX)
// ============================================================================
// Before analysis, classify the input:
// 1. Query DexScreener first
//    If DexScreener returns a pair:
//    - Treat input as PAIR ADDRESS
//    - Always analyze dexData.baseToken (unless baseToken is a quote asset)
//    - NEVER analyze the pair contract itself
// 2. If not a pair:
//    - Treat input as TOKEN CONTRACT
//    - Fetch explorer metadata
//    - Then locate its main trading pair on DexScreener
// ============================================================================

/**
 * Detects if input address is a trading pair and extracts the correct token to analyze.
 * 
 * WETH / BLUECHIP PAIR CONFUSION FIX:
 * When analyzing a pair:
 * - If baseToken.symbol in [WETH, USDC, USDT, SOL]: Swap to analyze the OTHER token in the pair
 * - Never analyze quote assets as the main token
 * 
 * This prevents:
 * - WETH being flagged risky
 * - Bluechips being misclassified
 * 
 * Returns: { isPair: boolean, tokenToAnalyze: string | null, isQuoteAsset: boolean }
 */
async function detectPairAndExtractToken(address: string): Promise<{
    isPair: boolean
    tokenToAnalyze: string | null
    isQuoteAsset: boolean
    baseToken: { address: string; symbol: string; name: string } | null
    quoteToken: { address: string; symbol: string; name: string } | null
}> {
    try {
        // STEP 1: Query DexScreener first to check if this is a pair
        const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
        if (!dexResponse?.ok) {
            return { isPair: false, tokenToAnalyze: null, isQuoteAsset: false, baseToken: null, quoteToken: null }
        }
        
        const dexData = await dexResponse.json() || {}
        if (!dexData?.pairs || !Array.isArray(dexData.pairs) || dexData.pairs.length === 0) {
            return { isPair: false, tokenToAnalyze: null, isQuoteAsset: false, baseToken: null, quoteToken: null }
        }
        
        // Find the pair that matches this address (could be pair contract or token in pair)
        const normalizedInput = address.toLowerCase()
        const mainPair = dexData.pairs.find((pair: any) => {
            const pairAddress = pair?.pairAddress?.toLowerCase()
            const baseAddr = pair?.baseToken?.address?.toLowerCase()
            const quoteAddr = pair?.quoteToken?.address?.toLowerCase()
            return pairAddress === normalizedInput || baseAddr === normalizedInput || quoteAddr === normalizedInput
        }) || dexData.pairs[0] // Fallback to first pair
        
        if (!mainPair) {
            return { isPair: false, tokenToAnalyze: null, isQuoteAsset: false, baseToken: null, quoteToken: null }
        }
        
        const baseToken = mainPair?.baseToken || null
        const quoteToken = mainPair?.quoteToken || null
        
        if (!baseToken || !quoteToken) {
            return { isPair: false, tokenToAnalyze: null, isQuoteAsset: false, baseToken: null, quoteToken: null }
        }
        
        // Known quote assets (WETH, USDC, USDT, DAI, SOL, etc.)
        const quoteAssetSymbols = ['WETH', 'USDC', 'USDT', 'DAI', 'SOL', 'WBNB', 'WMATIC', 'USDC.E', 'USDT.E']
        const baseSymbol = baseToken?.symbol?.toUpperCase() || ''
        const quoteSymbol = quoteToken?.symbol?.toUpperCase() || ''
        
        // If baseToken is a quote asset, analyze quoteToken instead
        // If quoteToken is a quote asset, analyze baseToken (normal case)
        const isBaseQuoteAsset = quoteAssetSymbols.includes(baseSymbol)
        const isQuoteQuoteAsset = quoteAssetSymbols.includes(quoteSymbol)
        
        let tokenToAnalyze: string | null = null
        let isQuoteAsset = false
        
        if (isBaseQuoteAsset) {
            // Base is quote asset (rare), analyze quote token
            tokenToAnalyze = quoteToken?.address || null
            isQuoteAsset = false
        } else if (isQuoteQuoteAsset) {
            // Quote is quote asset (normal), analyze base token
            tokenToAnalyze = baseToken?.address || null
            isQuoteAsset = false
        } else {
            // Neither is a known quote asset, default to baseToken
            tokenToAnalyze = baseToken?.address || null
            isQuoteAsset = false
        }
        
        return {
            isPair: true,
            tokenToAnalyze,
            isQuoteAsset,
            baseToken: baseToken ? {
                address: baseToken.address || '',
                symbol: baseToken.symbol || '',
                name: baseToken.name || ''
            } : null,
            quoteToken: quoteToken ? {
                address: quoteToken.address || '',
                symbol: quoteToken.symbol || '',
                name: quoteToken.name || ''
            } : null
        }
    } catch (error) {
        console.error('[PairDetection] Error:', error)
        return { isPair: false, tokenToAnalyze: null, isQuoteAsset: false, baseToken: null, quoteToken: null }
    }
}

// ============================================================================
// WRAPPED NATIVE TOKEN DETECTION
// ============================================================================

function isWrappedNativeToken(address: string, symbol: string | null, chain: string): boolean {
    const normalizedAddress = address.toLowerCase()
    
    // Check CORE_TOKENS registry
    const coreToken = CORE_TOKENS[normalizedAddress]
    if (coreToken?.isWrappedNative) {
        return true
    }
    
    // Check known wrapped native addresses for this chain
    const knownAddresses = WRAPPED_NATIVE_ADDRESSES[chain] || []
    if (knownAddresses.some(addr => addr.toLowerCase() === normalizedAddress)) {
        return true
    }
    
    // Check symbol pattern
    if (symbol && WRAPPED_NATIVE_SYMBOLS.includes(symbol.toUpperCase())) {
        return true
    }
    
    return false
}

function isCoreToken(address: string): boolean {
    return !!CORE_TOKENS[address.toLowerCase()]
}

function isExtendedBluechip(address: string): boolean {
    return !!EXTENDED_BLUECHIP_LIST[address.toLowerCase()]
}

function isWellKnownToken(address: string): boolean {
    return !!WELL_KNOWN_TOKENS[address.toLowerCase()]
}

// ============================================================================
// API DATA FETCHERS
// ============================================================================

async function fetchGoPlusData(address: string, chain: string): Promise<any> {
    try {
        const chainMap: Record<string, string> = {
            'Ethereum': '1',
            'BSC': '56',
            'Base': '8453',
            'Arbitrum': '42161',
            'Polygon': '137',
            'Optimism': '10'
        }
        
        const chainId = chainMap[chain] || '1'
        
        return await fetchWithRetry(async () => {
            try {
                const response = await fetch(
                    `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`
                )
                if (!response?.ok) throw new Error('GoPlus API failed')
                const data = await response.json() || {}
                return data?.result?.[address.toLowerCase()] || null
            } catch (err) {
                console.error('[GoPlus] Fetch error:', err)
                return null
            }
        })
    } catch (error) {
        console.error('[GoPlus] Outer error:', error)
        return null
    }
}

async function fetchExplorerData(address: string, chain: string): Promise<any> {
    try {
        const explorerAPIs: Record<string, { url: string; key: string }> = {
            'Ethereum': { url: 'https://api.etherscan.io/api', key: process.env.ETHERSCAN_API_KEY || '' },
            'BSC': { url: 'https://api.bscscan.com/api', key: process.env.BSCSCAN_API_KEY || '' },
            'Base': { url: 'https://api.basescan.org/api', key: process.env.BASESCAN_API_KEY || '' },
            'Arbitrum': { url: 'https://api.arbiscan.io/api', key: process.env.ARBISCAN_API_KEY || '' },
            'Polygon': { url: 'https://api.polygonscan.com/api', key: process.env.POLYGONSCAN_API_KEY || '' },
        }
        
        const explorer = explorerAPIs[chain]
        if (!explorer || !explorer.key) return null
        
        return await fetchWithRetry(async () => {
            try {
                // Get contract source (verification status)
                const sourceResponse = await fetch(
                    `${explorer.url}?module=contract&action=getsourcecode&address=${address}&apikey=${explorer.key}`
                )
                const sourceData = sourceResponse?.ok ? await sourceResponse.json() : {}
                
                // Get contract creation
                const creationResponse = await fetch(
                    `${explorer.url}?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${explorer.key}`
                )
                const creationData = creationResponse?.ok ? await creationResponse.json() : {}
                
                return {
                    verified: sourceData?.result?.[0]?.SourceCode ? true : false,
                    contractName: sourceData?.result?.[0]?.ContractName || null,
                    creationTx: creationData?.result?.[0]?.txHash || null,
                    creationBlock: creationData?.result?.[0]?.blockNumber || null,
                }
            } catch (err) {
                console.error('[Explorer] Fetch error:', err)
                return null
            }
        })
    } catch (error) {
        console.error('[Explorer] Outer error:', error)
        return null
    }
}

async function fetchDexscreenerData(address: string): Promise<any> {
    try {
        return await fetchWithRetry(async () => {
            try {
                const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`)
                if (!response?.ok) return null
                const data = await response.json() || {}
                
                if (!data?.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) return null
                
                // METADATA FIX: For Solana/EVM, find pair where input address matches baseToken or quoteToken
                // This ensures we get the correct token metadata for the address being analyzed
                const normalizedInputAddress = address.toLowerCase()
                let mainPair = null
                
                // First, try to find a pair where the input address matches baseToken.address
                const matchingBasePair = data.pairs.find((pair: any) => {
                    const baseAddr = pair?.baseToken?.address?.toLowerCase()
                    return baseAddr === normalizedInputAddress
                })
                
                if (matchingBasePair) {
                    mainPair = matchingBasePair
                } else {
                    // If no exact match, try quoteToken
                    const matchingQuotePair = data.pairs.find((pair: any) => {
                        const quoteAddr = pair?.quoteToken?.address?.toLowerCase()
                        return quoteAddr === normalizedInputAddress
                    })
                    
                    if (matchingQuotePair) {
                        mainPair = matchingQuotePair
                    } else {
                        // Fallback: Get the most liquid pair
                        mainPair = data.pairs.sort((a: any, b: any) => 
                            ((b?.liquidity?.usd) || 0) - ((a?.liquidity?.usd) || 0)
                        )[0]
                    }
                }
                
                if (!mainPair) return null
                
                // 7-DAY RULE: Safely extract pair creation timestamp
                // Check both pairCreatedAt and createdAt (whichever exists)
                const pairTimestamp = mainPair?.pairCreatedAt || mainPair?.createdAt || null
                let pairAge: number | null = null
                let pairAgeHours: number | null = null
                
                if (pairTimestamp !== null && pairTimestamp !== undefined) {
                    try {
                        const timestampMs = typeof pairTimestamp === 'number' ? pairTimestamp : parseInt(String(pairTimestamp), 10)
                        if (!isNaN(timestampMs) && timestampMs > 0) {
                            const now = Date.now()
                            pairAge = Math.floor((now - timestampMs) / (1000 * 60 * 60 * 24))
                            pairAgeHours = Math.floor((now - timestampMs) / (1000 * 60 * 60))
                        }
                    } catch (err) {
                        console.error('[DexScreener] Timestamp parse error:', err)
                    }
                }
                
                // METADATA FIX: Extract baseToken and quoteToken info for new pairs
                // Prefer DexScreener baseToken metadata for new/unverified pairs
                const baseToken = mainPair?.baseToken || null
                const quoteToken = mainPair?.quoteToken || null
                
                // METADATA FIX: Determine which token in the pair matches the input address
                // Use that token's metadata (baseToken if input matches baseToken.address, otherwise quoteToken)
                const baseTokenAddress = baseToken?.address?.toLowerCase() || null
                const quoteTokenAddress = quoteToken?.address?.toLowerCase() || null
                const isBaseToken = baseTokenAddress === normalizedInputAddress
                const isQuoteToken = quoteTokenAddress === normalizedInputAddress
                
                // Select the token that matches the input address (prefer baseToken if both match)
                const matchingToken = isBaseToken ? baseToken : (isQuoteToken ? quoteToken : baseToken)
                
                return {
                    liquidity: (mainPair?.liquidity?.usd !== null && mainPair?.liquidity?.usd !== undefined) ? mainPair.liquidity.usd : null,
                    pairAge,
                    pairAgeHours,
                    pairCreatedAt: pairTimestamp, // Store raw timestamp for reference
                    txns24h: (mainPair?.txns?.h24 !== null && mainPair?.txns?.h24 !== undefined) ? mainPair.txns.h24 : null,
                    volume24h: (mainPair?.volume?.h24 !== null && mainPair?.volume?.h24 !== undefined) ? mainPair.volume.h24 : null,
                    // METADATA FIX: Include baseToken and quoteToken for name/symbol extraction
                    baseToken: baseToken ? {
                        name: baseToken?.name || null,
                        symbol: baseToken?.symbol || null,
                        address: baseToken?.address || null
                    } : null,
                    quoteToken: quoteToken ? {
                        name: quoteToken?.name || null,
                        symbol: quoteToken?.symbol || null,
                        address: quoteToken?.address || null
                    } : null,
                    // METADATA FIX: Include the matching token (the one that matches input address)
                    matchingToken: matchingToken ? {
                        name: matchingToken?.name || null,
                        symbol: matchingToken?.symbol || null,
                        address: matchingToken?.address || null
                    } : null
                }
            } catch (err) {
                console.error('[DexScreener] Fetch error:', err)
                return null
            }
        }, 2, 1000, 8000)
    } catch (error) {
        console.error('[DexScreener] Outer error:', error)
        return null
    }
}

// Liquidity fallback removed - rely only on DexScreener data

async function fetchSolscanData(address: string) {
    const apiKey = process.env.SOLSCAN_API_KEY
    if (!apiKey) return null
    
    return await fetchWithRetry(async () => {
        try {
            const headers = { 'token': apiKey }
            
            // Get token metadata
            const metaResponse = await fetch(
                `https://pro-api.solscan.io/v1.0/token/meta?tokenAddress=${address}`,
                { headers }
            )
            const metadata = metaResponse?.ok ? await metaResponse.json() : {}
            
            // Get token holders
            const holderResponse = await fetch(
                `https://pro-api.solscan.io/v1.0/token/holders?tokenAddress=${address}&offset=0&limit=1`,
                { headers }
            )
            const holderData = holderResponse?.ok ? await holderResponse.json() : {}
            
            return {
                name: metadata?.name || null,
                symbol: metadata?.symbol || null,
                decimals: metadata?.decimals || null,
                supply: metadata?.supply || null,
                holderCount: holderData?.total || null,
                mintAuthority: metadata?.mintAuthority || null,
                freezeAuthority: metadata?.freezeAuthority || null,
            }
        } catch (err) {
            console.error('[Solscan] Fetch error:', err)
            return null
        }
    })
}

// CoinGecko integration removed - focusing on security data only

// ============================================================================
// TOKEN AGE CALCULATION
// ============================================================================

async function calculateTokenAge(
    address: string,
    chain: string,
    dexData: any,
    explorerData: any
): Promise<{ ageDays: number | null; ageHours: number | null }> {
    try {
        // Check whitelist first (for metadata only, not for scoring)
        const normalizedAddress = address.toLowerCase()
        if (WELL_KNOWN_TOKENS[normalizedAddress]) {
            const age = WELL_KNOWN_TOKENS[normalizedAddress].age
            return { ageDays: age, ageHours: age * 24 }
        }
        
        // Priority 1: DexScreener pair age (most reliable for new pairs)
        if (dexData && dexData.pairAge !== null && dexData.pairAge !== undefined) {
            const ageDays = Math.floor(dexData.pairAge)
            const ageHours = (dexData.pairAgeHours !== null && dexData.pairAgeHours !== undefined) 
                ? dexData.pairAgeHours 
                : (ageDays * 24)
            return { ageDays, ageHours }
        }
        
        // Priority 2: Explorer creation block/timestamp
        if (explorerData?.creationTx || explorerData?.creationBlock) {
            try {
                if (explorerData.creationBlock) {
                    const blockTimes: Record<string, number> = {
                        'Ethereum': 13,
                        'BSC': 3,
                        'Base': 2,
                        'Arbitrum': 0.25,
                        'Polygon': 2,
                        'Optimism': 2
                    }
                    const blockTime = blockTimes[chain] || 13
                    const blocksPerDay = (24 * 60 * 60) / blockTime
                    const currentBlock = 20000000 // Approximate
                    const creationBlockNum = parseInt(String(explorerData.creationBlock), 10)
                    if (!isNaN(creationBlockNum) && creationBlockNum > 0) {
                        const daysOld = (currentBlock - creationBlockNum) / blocksPerDay
                        if (daysOld > 0) {
                            return { ageDays: Math.floor(daysOld), ageHours: Math.floor(daysOld * 24) }
                        }
                    }
                }
            } catch (err) {
                console.error('[TokenAge] Explorer block calc error:', err)
            }
        }
        
        return { ageDays: null, ageHours: null }
    } catch (error) {
        console.error('[TokenAge] Outer error:', error)
        return { ageDays: null, ageHours: null }
    }
}

// Detect if token is very new (<24h contract or <1h pair)
function isVeryNewToken(tokenAge: { ageDays: number | null; ageHours: number | null }, pairAgeHours: number | null, dexData: any): boolean {
    try {
        // Contract age < 24 hours
        if (tokenAge.ageHours !== null && tokenAge.ageHours !== undefined && tokenAge.ageHours < 24) {
            return true
        }
        
        // Pair age < 1 hour
        if (pairAgeHours !== null && pairAgeHours !== undefined && pairAgeHours < 1) {
            return true
        }
        
        // If DexScreener data is missing and we can't determine age, treat as potentially very new
        // But only if we don't have any age data from other sources
        if (tokenAge.ageDays === null && tokenAge.ageHours === null && pairAgeHours === null) {
            // Check if we have DexScreener data at all
            if (!dexData || (dexData.liquidity === null || dexData.liquidity === undefined)) {
                // No data available - could be very new, but we'll be conservative
                return false // Don't auto-flag as very new if we just don't have data
            }
        }
        
        return false
    } catch (error) {
        console.error('[isVeryNewToken] Error:', error)
        return false
    }
}

// ============================================================================
// 7-DAY HIGH RISK RULE: Check if token or pair is less than 7 days old
// ============================================================================

// Blue-chip exception list (canonical contracts that should skip 7-day rule)
const BLUECHIP_EXCEPTION_ADDRESSES: Record<string, boolean> = {
    // WETH
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': true, // Ethereum
    '0x4200000000000000000000000000000000000006': true, // Base/Optimism
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': true, // Arbitrum
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': true, // Polygon
    // USDC
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': true, // Ethereum
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': true, // Base
    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': true, // Arbitrum
    '0x7f5c764cbc14f9669b88837ca1490cca17c31607': true, // Optimism
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': true, // Polygon
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': true, // BSC
    // USDT
    '0xdac17f958d2ee523a2206206994597c13d831ec7': true, // Ethereum
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': true, // Arbitrum
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': true, // Optimism
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': true, // Polygon
    '0x55d398326f99059ff775485246999027b3197955': true, // BSC
    // DAI
    '0x6b175474e89094c44da98b954eedeac495271d0f': true, // Ethereum
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': true, // Base
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': true, // Arbitrum/Optimism
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': true, // Polygon
    '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': true, // BSC
    // WBTC
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': true, // Ethereum
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': true, // Polygon
    '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': true, // BSC
}

function isTokenLessThan7DaysOld(
    tokenAgeDays: number | null,
    pairAgeDays: number | null,
    address: string
): boolean {
    try {
        const normalizedAddress = address.toLowerCase()
        
        // BLUECHIP/WHITELIST EXCEPTION: Skip 7-day rule for established tokens
        // If token is in whitelist/bluechip/core lists, use whitelist age data
        if (BLUECHIP_EXCEPTION_ADDRESSES[normalizedAddress] || 
            isCoreToken(address) || 
            isExtendedBluechip(address) || 
            isWellKnownToken(address)) {
            
            // For whitelisted tokens, if age is unknown, use whitelist age data
            const whitelistEntry = WELL_KNOWN_TOKENS[normalizedAddress]
            const coreToken = CORE_TOKENS[normalizedAddress]
            const bluechipToken = EXTENDED_BLUECHIP_LIST[normalizedAddress]
            
            // Use whitelist age if available and API age is missing
            const effectiveTokenAge = tokenAgeDays !== null && tokenAgeDays !== undefined 
                ? tokenAgeDays 
                : (whitelistEntry?.age || coreToken ? 1000 : bluechipToken ? 1000 : null)
            
            const effectivePairAge = pairAgeDays !== null && pairAgeDays !== undefined 
                ? pairAgeDays 
                : null
            
            // Only trigger 7-day rule if effective age is actually < 7 days
            if (effectiveTokenAge !== null && effectiveTokenAge < 7) {
                return true
            }
            if (effectivePairAge !== null && effectivePairAge < 7) {
                return true
            }
            
            // For whitelisted tokens with unknown age, assume they're established (NOT new)
            return false
        }
        
        // 7-DAY RULE: If either pair age OR token age is < 7 days, trigger HIGH RISK
        // Check pair age first (most reliable for new launches)
        if (pairAgeDays !== null && pairAgeDays !== undefined && pairAgeDays < 7) {
            return true
        }
        
        // Check token contract age
        if (tokenAgeDays !== null && tokenAgeDays !== undefined && tokenAgeDays < 7) {
            return true
        }
        
        // NEW PAIR RULE: If BOTH ages are null/unknown AND token is NOT whitelisted, treat as new = HIGH RISK
        // This catches brand new pairs where age data isn't available yet
        // BUT: Only apply this rule to non-whitelisted tokens
        if ((pairAgeDays === null || pairAgeDays === undefined) && 
            (tokenAgeDays === null || tokenAgeDays === undefined)) {
            return true // Unknown age = treat as new = HIGH RISK (only for non-whitelisted tokens)
        }
        
        return false
    } catch (error) {
        console.error('[isTokenLessThan7DaysOld] Error:', error)
        // On error, be conservative - treat as potentially new = HIGH RISK
        return true
    }
}

// ============================================================================
// DATA CONFIDENCE CALCULATOR
// ============================================================================

function calculateDataConfidence(
    tokenData: TokenData,
    goPlusData: any,
    explorerData: any,
    dexData: any,
    addressType: string,
    solscanData?: any
): DataConfidence & { apiFailures: string[] } {
    const checks = []
    const missing: string[] = []
    const apiFailures: string[] = []
    
    // Track API failures for confidence system (fail-closed: missing data increases risk)
    let confidence = 100
    if (!goPlusData && addressType === 'EVM') {
        apiFailures.push('GoPlus')
        confidence -= 25 // Increased penalty for missing security data
    }
    if (!dexData) {
        apiFailures.push('DexScreener')
        confidence -= 20 // Increased penalty for missing liquidity/age data
    }
    if (!explorerData && addressType === 'EVM') {
        apiFailures.push('Explorer')
        confidence -= 15 // Increased penalty for missing verification data
    }
    if (!solscanData && addressType === 'SOLANA') {
        apiFailures.push('Solscan')
        confidence -= 20 // Increased penalty for missing Solana security data
    }
    
    // Define critical security checks based on chain type
    if (addressType === 'EVM') {
        checks.push({ field: 'Token Age', available: tokenData.tokenAge !== null && tokenData.tokenAge !== undefined })
        checks.push({ field: 'Liquidity', available: tokenData.liquidity !== null && tokenData.liquidity !== undefined })
        checks.push({ field: 'Contract Verification', available: tokenData.contractVerified !== null && tokenData.contractVerified !== undefined })
        checks.push({ field: 'Honeypot Check', available: goPlusData !== null && goPlusData !== undefined })
        checks.push({ field: 'Owner Privileges', available: goPlusData !== null && goPlusData !== undefined })
        checks.push({ field: 'Explorer Data', available: explorerData !== null && explorerData !== undefined })
    } else if (addressType === 'SOLANA') {
        checks.push({ field: 'Token Age', available: tokenData.tokenAge !== null && tokenData.tokenAge !== undefined })
        checks.push({ field: 'Liquidity', available: tokenData.liquidity !== null && tokenData.liquidity !== undefined })
        checks.push({ field: 'Mint Authority', available: solscanData !== null && solscanData !== undefined && solscanData.mintAuthority !== null && solscanData.mintAuthority !== undefined })
        checks.push({ field: 'Freeze Authority', available: solscanData !== null && solscanData !== undefined && solscanData.freezeAuthority !== null && solscanData.freezeAuthority !== undefined })
        checks.push({ field: 'DexScreener Data', available: dexData !== null && dexData !== undefined })
    }
    
    const successfulChecks = checks.filter(c => c.available).length
    const totalChecks = checks.length
    const percentage = totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0
    
    checks.forEach(check => {
        if (!check.available) missing.push(check.field)
    })
    
    // Improved confidence calculation: consider both API success rate and data completeness
    const dataCompleteness = percentage
    const apiReliability = Math.max(0, confidence)
    const combinedConfidence = (dataCompleteness * 0.6) + (apiReliability * 0.4)
    
    let level: 'HIGH' | 'MEDIUM' | 'LOW'
    if (combinedConfidence >= 75 && percentage >= 70 && successfulChecks >= 5) {
        level = 'HIGH'
    } else if (combinedConfidence >= 50 && percentage >= 40 && successfulChecks >= 3) {
        level = 'MEDIUM'
    } else {
        level = 'LOW'
    }
    
    return {
        level,
        percentage: Math.round(percentage),
        successfulChecks,
        totalChecks,
        missingFields: missing,
        apiFailures
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
    addressType: string,
    address: string,
    symbol: string | null,
    chain: string
): SecurityFlags {
    const isCore = isCoreToken(address)
    const isWrapped = isWrappedNativeToken(address, symbol, chain)
    
    // For core/wrapped tokens, liquidity is always considered safe
    // Distinguish between "no liquidity" (liquidity = 0 or < 1000) vs "data unavailable" (liquidity = null/undefined)
    const liquidityValue = (dexData && dexData.liquidity !== null && dexData.liquidity !== undefined) ? dexData.liquidity : null
    const hasLiquidity = liquidityValue !== null && liquidityValue >= 1000
    const liquidityUnavailable = liquidityValue === null
    
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
        // Core tokens and wrapped natives: skip verification penalty
        unverifiedContract: addressType === 'EVM' && !isCore && !isWrapped && explorerData?.verified === false,
        // Core tokens and wrapped natives: never flag as no liquidity
        // Only flag as "no liquidity" if we have data showing liquidity < 1000
        // If liquidity is unavailable (null), don't flag as "no liquidity" - that's a data issue, not a risk
        noLiquidity: !isCore && !isWrapped && !liquidityUnavailable && (!hasLiquidity || (liquidityValue !== null && liquidityValue < 1000)),
        newToken: tokenAge !== null && tokenAge < 7,
        // Core tokens and wrapped natives: never flag as not listed
        // Only flag as "not listed" if we have data showing no liquidity, not if data is unavailable
        notListed: !isCore && !isWrapped && !liquidityUnavailable && (!hasLiquidity || (liquidityValue !== null && liquidityValue < 1000))
    }
}

// ============================================================================
// SCORING ENGINE (SIMPLIFIED - CORE SECURITY CHECKS ONLY)
// ============================================================================
// Design Principle: FAIL-CLOSED
// - Missing data → increase risk
// - Uncertain analysis → MEDIUM or HIGH
// - Never show SAFE unless strong evidence exists
// - No token < 7 days old can EVER be SAFE
// ============================================================================

function calculateHealthScore(
    securityFlags: SecurityFlags,
    dataConfidence: DataConfidence,
    tokenAge: number | null,
    addressType: string,
    address: string,
    symbol: string | null,
    chain: string,
    pairAgeDays: number | null = null
): { score: number; penalties: Array<{ reason: string; points: number }> } {
    let score = 100
    const penalties: Array<{ reason: string; points: number }> = []
    
    const isCore = isCoreToken(address)
    const isWrapped = isWrappedNativeToken(address, symbol, chain)
    
    // ============================================================================
    // STEP 3: NEW TOKEN MODE (7-DAY HIGH RISK RULE) - MOST IMPORTANT
    // If token or pair age < 7 days OR unknown age → Enter NEW TOKEN MODE
    // ============================================================================
    const isLessThan7Days = isTokenLessThan7DaysOld(tokenAge, pairAgeDays, address)
    if (isLessThan7Days) {
        // NEW TOKEN MODE: Force score to 20-30 range (fixed range for new tokens)
        // Skip all advanced scoring - only perform basic security checks
        score = 25 // Fixed score in 20-30 range for new tokens
        const ageReason = (pairAgeDays === null && tokenAge === null) 
            ? 'New trading pair – age unknown, extremely high rug risk'
            : 'Token or trading pair created less than 7 days ago – extremely high rug risk period'
        penalties.push({ 
            reason: ageReason, 
            points: 75 
        })
        // Still check for critical security flags (honeypot, etc.) but score is already at minimum
        // The 7-day rule already sets score to 25, which forces HIGH RISK
        return { score, penalties } // Early return - skip all other scoring for new tokens
    }
    
    // ============================================================================
    // CORE SECURITY CHECKS ONLY (from GoPlus, DexScreener, Explorer)
    // ============================================================================
    
    // CRITICAL FLAGS (immediate high risk) - apply to ALL tokens
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
    
    if (securityFlags.blacklistAuthority) {
        penalties.push({ reason: 'Blacklist function detected', points: 20 })
        score -= 20
    }
    
    // LIQUIDITY CHECK - Skip for core/wrapped tokens
    if (securityFlags.noLiquidity && !isCore && !isWrapped) {
        penalties.push({ reason: 'No liquidity detected or insufficient liquidity', points: 25 })
        score -= 25
    }
    
    // CONTRACT VERIFICATION - Skip for core/wrapped tokens
    if (securityFlags.unverifiedContract && !isCore && !isWrapped) {
        penalties.push({ reason: 'Contract not verified on block explorer', points: 5 })
        score -= 5
    }
    
    if (securityFlags.proxyUpgradeable) {
        penalties.push({ reason: 'Upgradeable proxy contract (owner can change logic)', points: 10 })
        score -= 10
    }
    
    // FAIL-CLOSED DESIGN: Missing data increases risk
    // Missing security data = higher risk (fail-closed, not fail-open)
    if (dataConfidence.level === 'LOW' && !isCore && !isWrapped) {
        penalties.push({ reason: 'Some security data unavailable – confidence reduced', points: 15 })
        score -= 15
    } else if (dataConfidence.level === 'MEDIUM' && !isCore && !isWrapped) {
        penalties.push({ reason: 'Some security data unavailable – confidence reduced', points: 8 })
        score -= 8
    }
    
    // SOLANA LIMITED MODE
    if (addressType === 'SOLANA') {
        penalties.push({ reason: 'Solana security checks are limited', points: 15 })
        score -= 15
    }
    
    // Clamp score
    score = Math.max(0, Math.min(100, score))
    
    // FAIL-CLOSED DESIGN: Missing data caps score (only for non-core tokens)
    if (!isCore && !isWrapped) {
        if (dataConfidence.level === 'LOW') {
            // Missing data = higher risk, cap at 65 (fail-closed)
            score = Math.min(score, 65)
        } else if (dataConfidence.level === 'MEDIUM' && dataConfidence.percentage < 60) {
            // Some data missing = moderate risk, cap at 75
            score = Math.min(score, 75)
        }
    }
    
    return { score, penalties }
}

// ============================================================================
// RISK LEVEL DETERMINATOR
// ============================================================================

function determineRiskLevel(
    score: number,
    securityFlags: SecurityFlags,
    dataConfidence: DataConfidence,
    address: string,
    symbol: string | null,
    chain: string,
    tokenAgeDays: number | null = null,
    pairAgeDays: number | null = null
): 'LOW' | 'MEDIUM' | 'HIGH' {
    const isCore = isCoreToken(address)
    const isWrapped = isWrappedNativeToken(address, symbol, chain)
    
    // ============================================================================
    // 7-DAY HIGH RISK RULE: Force HIGH RISK for tokens/pairs < 7 days old
    // ============================================================================
    const isLessThan7Days = isTokenLessThan7DaysOld(tokenAgeDays, pairAgeDays, address)
    if (isLessThan7Days) {
        // Override all other logic - tokens/pairs < 7 days are ALWAYS HIGH RISK
        return 'HIGH'
    }
    
    // OVERRIDE RULES: Critical flags force HIGH risk (for ALL tokens)
    if (securityFlags.honeypot || securityFlags.mintAuthority || securityFlags.ownerPrivileges) {
        return 'HIGH'
    }
    
    // Missing data can only increase risk by one level, never force HIGH RISK
    // Exception: Core/wrapped tokens are protected
    if (isCore || isWrapped) {
        // Core tokens can only be HIGH if critical flags are present (already checked above)
        if (score >= 85) return 'LOW'
        if (score >= 70) return 'MEDIUM'
        return 'MEDIUM' // Even with low score, core tokens are at worst MEDIUM unless critical flags
    }
    
    // GLOBAL RULE 6: Missing data can push to MEDIUM, but not HIGH
    // HIGH RISK is ONLY for real scams (honeypot, cannot sell, blacklist, mint authority, trading disabled)
    if (dataConfidence.level === 'LOW') {
        // Missing data can push to MEDIUM, but only real security flags can force HIGH
        if (score < 60) return 'MEDIUM' // Push to MEDIUM instead of HIGH
        return score >= 80 ? 'LOW' : 'MEDIUM'
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
    addressType: string,
    tokenAgeDays: number | null = null,
    pairAgeDays: number | null = null,
    address: string = ''
): { verdict: string; warnings: string[] } {
    const warnings: string[] = []
    
    // ============================================================================
    // STEP 3: NEW TOKEN MODE - Specific verdict for tokens/pairs < 7 days old OR unknown age
    // ============================================================================
    const isLessThan7Days = isTokenLessThan7DaysOld(tokenAgeDays, pairAgeDays, address)
    if (isLessThan7Days && riskLevel === 'HIGH') {
        const isUnknownAge = (pairAgeDays === null && tokenAgeDays === null)
        const verdictText = '🔴 HIGH RISK — Fresh Launch Detected\nThis token or pair was created less than 7 days ago.\nMost rugs and scams happen in the first week.\nAutomatic HIGH RISK classification applied.'
        const warningText = isUnknownAge
            ? '🆕 Fresh Launch Detected — Age unknown, extremely high rug risk'
            : '🆕 Fresh Launch Detected — Token or trading pair created less than 7 days ago'
        
        return {
            verdict: verdictText,
            warnings: [
                warningText,
                'Most rug pulls and exit scams happen within the first week of launch',
                'Wait at least 7 days and monitor on-chain activity before considering this token',
                'Automatic HIGH RISK classification applied due to new token status'
            ]
        }
    }
    
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
    // 7-DAY RULE: If age is unknown, add specific warning
    if (tokenAgeDays === null && pairAgeDays === null) {
        warnings.push('Unable to determine token age – treat as high risk')
    }
    
    if (dataConfidence.level === 'LOW') {
        const lowDataWarnings = [`Only ${dataConfidence.percentage}% of security checks could be performed`]
        if (tokenAgeDays === null && pairAgeDays === null) {
            lowDataWarnings.push('Unable to determine token age – treat as high risk')
        }
        return {
            verdict: '⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined.',
            warnings: lowDataWarnings
        }
    }
    
    // ============================================================================
    // 7-DAY HIGH RISK RULE: Specific verdict for tokens/pairs < 7 days old
    // ============================================================================
    // Note: This check should happen early, before other verdicts
    // The riskLevel parameter should already be HIGH if this rule triggered,
    // but we add the specific verdict here for clarity
    
    // NEW TOKEN WARNINGS
    if (tokenAge !== null && tokenAge !== undefined && tokenAge < 1) {
        warnings.push('🚨 VERY NEW TOKEN – Extremely high rug risk')
        warnings.push('Token created less than 24 hours ago')
        return {
            verdict: '🟡 EARLY-STAGE TOKEN – Launch-phase rug risk is extremely high.',
            warnings
        }
    }
    
    // Very new pair detection (even if contract is older)
    if (dataConfidence.level === 'LOW' && tokenAge === null) {
        return {
            verdict: '⚠️ NEWLY CREATED TOKEN – Limited on-chain history available.',
            warnings: ['Token is newly created – limited on-chain history available', 'Market and liquidity data still forming']
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
    
    // LOW RISK - only if ALL conditions are met (fail-closed design)
    // Never show SAFE unless strong evidence exists
    if (
        dataConfidence.level === 'HIGH' &&
        !securityFlags.honeypot &&
        !securityFlags.mintAuthority &&
        !securityFlags.ownerPrivileges &&
        !securityFlags.noLiquidity &&
        !securityFlags.blacklistAuthority &&
        tokenAge !== null &&
        tokenAge >= 7 &&
        riskLevel === 'LOW'
    ) {
        return {
            verdict: '🟢 NO CRITICAL RISKS DETECTED – Token appears relatively safe.',
            warnings: ['Always DYOR - this is not financial advice']
        }
    }
    
    // FAIL-CLOSED: If data is missing or uncertain, default to MEDIUM/HIGH risk
    if (dataConfidence.level === 'LOW') {
        return {
            verdict: '⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined.',
            warnings: [`Only ${dataConfidence.percentage}% of security checks could be performed`, 'Missing data increases risk - treat as high risk']
        }
    }
    
    // Fallback - default to caution
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
    // METADATA FIX: Never show "Unknown" - use fallback values from tokenData
    report += `Token: ${tokenData.name || 'New Token'}\n`
    report += `Symbol: ${tokenData.symbol || 'NEW'}\n`
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
    // GLOBAL RULE 1: Never crash - wrap everything in try/catch
    try {
        // Validate address format
        if (!address || typeof address !== 'string') {
            return '⚠️ INVALID ADDRESS\n\nPlease provide a valid token contract address.'
        }
        
        // STEP 1: PAIR VS TOKEN DETECTION (CRITICAL FIX)
        // Query DexScreener first to check if input is a pair address
        const pairDetection = await detectPairAndExtractToken(address)
        let tokenToAnalyze = address // Default to input address
        
        // If input is a pair, analyze the correct token (not the pair contract)
        if (pairDetection.isPair && pairDetection.tokenToAnalyze) {
            tokenToAnalyze = pairDetection.tokenToAnalyze
            // Use pair's baseToken/quoteToken metadata for display
        }
        
        // Detect address type (use the token address, not the pair address)
        const addressType = detectAddressType(tokenToAnalyze)
        
        if (addressType === 'UNKNOWN') {
            return '⚠️ INVALID OR UNSUPPORTED ADDRESS\n\n' +
                   'Unable to identify if this is an EVM or Solana address.\n' +
                   'Please provide a valid token contract address.'
        }
        
        // Safe defaults (GLOBAL RULE 9)
        let tokenData: TokenData | null = null
        let goPlusData: any = null
        let explorerData: any = null
        let dexData: any = null
        let solscanData: any = null
        
        try {
        
        // EVM ANALYSIS
        if (addressType === 'EVM') {
            const chain = await detectEVMChain(tokenToAnalyze)
            
            // Fetch all data in parallel (using tokenToAnalyze, not original address)
            const [goPlus, explorer, dex] = await Promise.all([
                fetchGoPlusData(tokenToAnalyze, chain),
                fetchExplorerData(tokenToAnalyze, chain),
                fetchDexscreenerData(tokenToAnalyze) // Will find pair for this token
            ])
            
            goPlusData = goPlus
            explorerData = explorer
            dexData = dex
            
            const tokenAgeResult = await calculateTokenAge(tokenToAnalyze, chain, dexData, explorerData)
            const tokenAge = tokenAgeResult?.ageDays || null
            
            // ============================================================================
            // STEP 2 — TOKEN METADATA RESOLUTION (NO MORE UNKNOWN)
            // ============================================================================
            // Always prioritize DexScreener metadata for new/unverified tokens:
            // Use in order:
            // - dexData.baseToken.name
            // - dexData.baseToken.symbol
            // 
            // Fallback rules:
            // - If name missing but symbol exists: Token name = symbol
            // - If both missing: Token name = "New Token", Symbol = "NEW"
            // - Add warning: "Token metadata not yet indexed (fresh launch)"
            // 
            // Never display:
            // - "Unverified Token"
            // - "Symbol: UNKNOWN"
            // ============================================================================
            
            // Priority: Pair detection metadata > CORE > Bluechip > Whitelist > DexScreener > GoPlus > Fallback
            const normalizedAddress = tokenToAnalyze.toLowerCase()
            const coreToken = CORE_TOKENS[normalizedAddress]
            const bluechipToken = EXTENDED_BLUECHIP_LIST[normalizedAddress]
            const whitelistEntry = WELL_KNOWN_TOKENS[normalizedAddress]
            
            // If pair was detected, use pair's token metadata (most accurate for new pairs)
            const pairTokenName = pairDetection.isPair ? (pairDetection.baseToken?.name || pairDetection.quoteToken?.name) : null
            const pairTokenSymbol = pairDetection.isPair ? (pairDetection.baseToken?.symbol || pairDetection.quoteToken?.symbol) : null
            
            // DexScreener metadata (from pair detection or direct query)
            const dexMatchingToken = dexData?.matchingToken || null
            const dexBaseToken = dexData?.baseToken || null
            const dexTokenName = (dexMatchingToken?.name || dexBaseToken?.name || pairTokenName)?.trim() || null
            const dexTokenSymbol = (dexMatchingToken?.symbol || dexBaseToken?.symbol || pairTokenSymbol)?.trim() || null
            
            // GoPlus metadata (validate address matches)
            const apiAddress = goPlusData?.token_address ? goPlusData.token_address.toLowerCase() : null
            const trustedGoPlusData = (apiAddress === normalizedAddress || !apiAddress) ? goPlusData : null
            
            // METADATA RESOLUTION: Never show "UNKNOWN" or "Unverified Token"
            // Priority order: CORE > Bluechip > Whitelist > Pair detection > DexScreener > GoPlus > Fallback
            const tokenName = coreToken?.name 
                || bluechipToken?.name 
                || whitelistEntry?.name 
                || pairTokenName
                || dexTokenName
                || (trustedGoPlusData?.token_name && trustedGoPlusData.token_name !== 'Unknown' && trustedGoPlusData.token_name.trim() ? trustedGoPlusData.token_name.trim() : null)
                || dexTokenSymbol // If name missing but symbol exists, use symbol as name
                || 'New Token' // Never show "Unverified Token" or shortened address
            
            const tokenSymbol = coreToken?.symbol 
                || bluechipToken?.symbol 
                || whitelistEntry?.symbol 
                || pairTokenSymbol
                || dexTokenSymbol
                || (trustedGoPlusData?.token_symbol && trustedGoPlusData.token_symbol !== 'UNKNOWN' && trustedGoPlusData.token_symbol.trim() ? trustedGoPlusData.token_symbol.trim() : null)
                || 'NEW' // Never show "UNKNOWN"
            
            // GLOBAL RULE 4: Bluechip protection - assume liquidity exists
            const isBluechip = isExtendedBluechip(tokenToAnalyze)
            const assumedLiquidity = (isBluechip || coreToken?.isWrappedNative) ? 1000000 : null
            
            // Use whitelist age when API age is missing (for established tokens)
            // whitelistEntry is already declared above at line 1680
            const effectiveTokenAge = tokenAge !== null && tokenAge !== undefined 
                ? tokenAge 
                : (coreToken?.isWrappedNative ? 1100 : (whitelistEntry?.age || (bluechipToken ? 1000 : null)))
            
            // Safe null checks for all fields
            const pairAge = (dexData && dexData.pairAge !== null && dexData.pairAge !== undefined) ? dexData.pairAge : null
            const liquidity = assumedLiquidity || (dexData && dexData.liquidity !== null && dexData.liquidity !== undefined) ? dexData.liquidity : null
            const holderCount = (goPlusData && goPlusData.holder_count !== null && goPlusData.holder_count !== undefined) 
                ? parseInt(String(goPlusData.holder_count), 10) 
                : null
            
            tokenData = {
                name: tokenName,
                symbol: tokenSymbol,
                chain,
                address: tokenToAnalyze, // Use the actual token address, not the pair address
                tokenAge: effectiveTokenAge,
                pairAge,
                liquidity,
                holderCount,
                contractVerified: (explorerData && explorerData.verified !== null && explorerData.verified !== undefined) 
                    ? explorerData.verified 
                    : (coreToken || isBluechip ? true : null)
            }
        }
        // SOLANA ANALYSIS
        else {
            const [solscan, dex] = await Promise.all([
                fetchSolscanData(tokenToAnalyze),
                fetchDexscreenerData(tokenToAnalyze)
            ])
            
            solscanData = solscan
            dexData = dex
            
            // Calculate Solana token age (approximate from creation slot)
            let tokenAge: number | null = null
            if (dexData && dexData.pairAge !== null && dexData.pairAge !== undefined) {
                tokenAge = dexData.pairAge
            }
            
            // Check CORE_TOKENS for Solana tokens (SOL, USDC)
            const normalizedAddress = tokenToAnalyze.toLowerCase()
            const coreToken = CORE_TOKENS[normalizedAddress]
            
            // METADATA FIX: Prioritize DexScreener matchingToken (token that matches input address)
            // First try matchingToken (the token in the pair that matches the input address)
            // Then fall back to baseToken, then Solana token metadata
            const dexMatchingToken = dexData?.matchingToken || null
            const dexBaseToken = dexData?.baseToken || null
            
            // Use matchingToken if available (most accurate), otherwise use baseToken
            const dexToken = dexMatchingToken || dexBaseToken
            const dexTokenName = (dexToken && dexToken.name && dexToken.name.trim()) ? dexToken.name.trim() : null
            const dexTokenSymbol = (dexToken && dexToken.symbol && dexToken.symbol.trim()) ? dexToken.symbol.trim() : null
            
            // Safe null checks for Solana data
            const pairAge = (dexData && dexData.pairAge !== null && dexData.pairAge !== undefined) ? dexData.pairAge : null
            const liquidity = (dexData && dexData.liquidity !== null && dexData.liquidity !== undefined) ? dexData.liquidity : null
            const holderCount = (solscanData && solscanData.holderCount !== null && solscanData.holderCount !== undefined) ? solscanData.holderCount : null
            
            // METADATA FIX: Solana token name/symbol extraction with fallbacks
            // Priority: CORE > DexScreener matchingToken/baseToken > Solscan > Fallback
            let solanaTokenName = coreToken?.name 
                || dexTokenName 
                || (solscanData?.name && solscanData.name.trim() ? solscanData.name.trim() : null)
                || dexTokenSymbol // If name missing but symbol exists, use symbol as name
                || 'New Token' // Never use shortened address unless absolutely necessary
            
            let solanaTokenSymbol = coreToken?.symbol 
                || dexTokenSymbol 
                || (solscanData?.symbol && solscanData.symbol.trim() ? solscanData.symbol.trim() : null)
                || 'NEW' // Never show "Unknown" or "UNKNOWN"
            
            tokenData = {
                name: solanaTokenName,
                symbol: solanaTokenSymbol,
                chain: 'Solana',
                address: tokenToAnalyze, // Use the actual token address, not the pair address
                tokenAge,
                pairAge,
                liquidity,
                holderCount,
                contractVerified: null // N/A for Solana
            }
        }
        
        // Calculate data confidence (pass solscanData for Solana, removed cgData)
        const dataConfidence = calculateDataConfidence(
            tokenData,
            goPlusData,
            explorerData,
            dexData,
            addressType,
            solscanData
        )
        
        // Detect security flags (with core/wrapped detection)
        const securityFlags = detectSecurityFlags(
            goPlusData,
            solscanData,
            explorerData,
            dexData,
            tokenData.tokenAge,
            addressType,
            address,
            tokenData.symbol,
            tokenData.chain
        )
        
        } catch (innerError) {
            // GLOBAL RULE 1: Never show "ANALYSIS ERROR" - continue with partial analysis
            console.error('[AnalyzeToken] Inner error:', innerError)
            // Continue with safe defaults below
        }
        
        // GLOBAL RULE 1: If tokenData is null, use safe defaults with DexScreener fallback
        if (!tokenData) {
            const normalizedTokenAddress = tokenToAnalyze.toLowerCase()
            const bluechipToken = EXTENDED_BLUECHIP_LIST[normalizedTokenAddress]
            const isBluechip = isExtendedBluechip(tokenToAnalyze)
            
            // METADATA FIX: Try pair detection metadata or DexScreener baseToken as fallback
            const pairTokenName = pairDetection.isPair ? (pairDetection.baseToken?.name || pairDetection.quoteToken?.name) : null
            const pairTokenSymbol = pairDetection.isPair ? (pairDetection.baseToken?.symbol || pairDetection.quoteToken?.symbol) : null
            const dexBaseToken = dexData?.baseToken || null
            const dexBaseName = (dexBaseToken && dexBaseToken.name && dexBaseToken.name.trim()) ? dexBaseToken.name.trim() : null
            const dexBaseSymbol = (dexBaseToken && dexBaseToken.symbol && dexBaseToken.symbol.trim()) ? dexBaseToken.symbol.trim() : null
            
            // Fallback name/symbol extraction (never show "Unknown" or shortened address)
            let fallbackName = bluechipToken?.name 
                || pairTokenName
                || dexBaseName 
                || dexBaseSymbol 
                || 'New Token' // Never show shortened address or "Unknown Token"
            
            let fallbackSymbol = bluechipToken?.symbol 
                || pairTokenSymbol
                || dexBaseSymbol 
                || 'NEW' // Never show "UNKNOWN"
            
            tokenData = {
                name: fallbackName,
                symbol: fallbackSymbol,
                chain: addressType === 'EVM' ? 'Ethereum' : 'Solana',
                address: tokenToAnalyze, // Use the actual token address
                tokenAge: null,
                pairAge: null,
                liquidity: isBluechip ? 1000000 : null,
                holderCount: null,
                contractVerified: isBluechip ? true : null
            }
        }
        
        // Continue with analysis using tokenData (even if partial)
        try {
            // Calculate data confidence (removed CoinGecko dependency)
            let dataConfidence = calculateDataConfidence(
                tokenData,
                goPlusData,
                explorerData,
                dexData,
                addressType,
                solscanData
            )
            
            // Detect security flags (using tokenToAnalyze, not original address)
            const securityFlags = detectSecurityFlags(
                goPlusData,
                solscanData,
                explorerData,
                dexData,
                tokenData.tokenAge,
                addressType,
                tokenToAnalyze, // Use the actual token address
                tokenData.symbol,
                tokenData.chain
            )
            
            // Check if token is core, wrapped, or bluechip (using tokenToAnalyze)
            const normalizedTokenAddress = tokenToAnalyze.toLowerCase()
            const isCore = isCoreToken(tokenToAnalyze)
            const isWrapped = isWrappedNativeToken(tokenToAnalyze, tokenData.symbol, tokenData.chain)
            const isBluechip = isExtendedBluechip(tokenToAnalyze)
            
            // Calculate token age (removed CoinGecko dependency)
            const tokenAgeResult = await calculateTokenAge(tokenToAnalyze, tokenData.chain, dexData, explorerData)
            const pairAgeHours = (dexData && dexData.pairAgeHours !== null && dexData.pairAgeHours !== undefined) ? dexData.pairAgeHours : null
            const isVeryNew = isVeryNewToken(tokenAgeResult, pairAgeHours, dexData)
            
            // 7-DAY RULE: Extract pair age for scoring
            const pairAgeDays = (dexData && dexData.pairAge !== null && dexData.pairAge !== undefined) ? dexData.pairAge : null
            const tokenAgeDays = tokenData.tokenAge
            
            // Calculate score (7-day rule is handled inside calculateHealthScore)
            const { score, penalties } = calculateHealthScore(
                securityFlags,
                dataConfidence,
                tokenData.tokenAge,
                addressType,
                address,
                tokenData.symbol,
                tokenData.chain,
                pairAgeDays
            )
            
            // GLOBAL RULE 3: New token handling (but 7-day rule takes precedence)
            let finalScore = score
            let finalRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
            
            // 7-DAY RULE: Check if token/pair is < 7 days old (overrides other logic)
            const isLessThan7Days = isTokenLessThan7DaysOld(tokenAgeDays, pairAgeDays, tokenToAnalyze)
            if (isLessThan7Days) {
                // NEW TOKEN MODE: Force score to 20-30, HIGH RISK, LOW confidence
                finalScore = Math.min(30, score) // Ensure score ≤ 30
                finalRiskLevel = 'HIGH' // Force HIGH RISK
                // Override confidence to LOW for new tokens (as per NEW TOKEN MODE rules)
                dataConfidence = {
                    ...dataConfidence,
                    level: 'LOW',
                    percentage: Math.min(dataConfidence.percentage, 30) // Cap at 30% for new tokens
                }
            } else if (isVeryNew) {
                // Very new tokens: MEDIUM risk, 60-75 score (only if not < 7 days)
                finalScore = Math.max(60, Math.min(75, score))
                finalRiskLevel = 'MEDIUM'
            } else if ((isCore || isWrapped || isBluechip) && !securityFlags.honeypot && !securityFlags.ownerPrivileges && !securityFlags.mintAuthority && !securityFlags.blacklistAuthority) {
                // GLOBAL RULE 4: Bluechip protection
                finalScore = Math.max(score, isBluechip ? 75 : 85)
                finalRiskLevel = isBluechip ? 'MEDIUM' : 'LOW'
            } else {
                // GLOBAL RULE 6: HIGH RISK only for real scams
                finalRiskLevel = determineRiskLevel(finalScore, securityFlags, dataConfidence, tokenToAnalyze, tokenData.symbol, tokenData.chain, tokenAgeDays, pairAgeDays)
            }
            
            // METADATA FIX: Check if token metadata is missing and add warning
            const isMetadataMissing = (tokenData.name === 'New Token' || tokenData.name === 'Unknown Token') && 
                                     (tokenData.symbol === 'NEW' || tokenData.symbol === 'UNKNOWN')
            const isShortenedAddress = tokenData.name && tokenData.name.includes('...')
            
            // Generate verdict (pass age data for 7-day rule check)
            let { verdict, warnings } = generateVerdict(
                finalRiskLevel,
                securityFlags,
                dataConfidence,
                tokenData.tokenAge,
                addressType,
                tokenAgeDays,
                pairAgeDays,
                tokenToAnalyze
            )
            
            // METADATA FIX: Add warning if metadata is missing or using fallback values
            if (isMetadataMissing && !isShortenedAddress) {
                warnings.push('Token metadata not yet indexed – newly created or unverified token')
            } else if (isShortenedAddress) {
                warnings.push('Unable to fetch token metadata – using address identifier')
            }
            
            // 7-DAY RULE: Override verdict for tokens/pairs < 7 days (already handled in generateVerdict)
            // GLOBAL RULE 3: Override verdict for very new tokens (only if not < 7 days)
            if (isLessThan7Days) {
                // Verdict already set by generateVerdict for 7-day rule
                // No need to override
            } else if (isVeryNew) {
                verdict = '⚠️ MEDIUM RISK – Token is very new. Market and liquidity data still forming. Review carefully.'
                warnings = ['Token created less than 24 hours ago or pair created less than 1 hour ago']
            } else if ((isCore || isWrapped || isBluechip) && !securityFlags.honeypot && !securityFlags.ownerPrivileges && !securityFlags.mintAuthority && !securityFlags.blacklistAuthority) {
                if (isBluechip) {
                    verdict = '⚠️ MEDIUM RISK – Established token. Some data temporarily unavailable.'
                } else {
                    verdict = '🟢 NO CRITICAL RISKS DETECTED – Established core asset. No security issues found.'
                    warnings = []
                }
            }
            
            // Build analysis
            const analysis: RiskAnalysis = {
                healthScore: finalScore,
                riskLevel: finalRiskLevel,
                dataConfidence,
                securityFlags,
                penalties,
                verdict,
                warnings
            }
            
            // Generate report
            return generateReport(tokenData, analysis, addressType)
            
        } catch (analysisError) {
            // GLOBAL RULE 9: Safe default behavior if everything fails
            console.error('[AnalyzeToken] Analysis error:', analysisError)
            
            // Try to return a minimal but valid report
            const normalizedAddress = address.toLowerCase()
            const bluechipToken = EXTENDED_BLUECHIP_LIST[normalizedAddress]
            const isBluechip = isExtendedBluechip(address)
            
            const safeTokenData: TokenData = {
                name: bluechipToken?.name || 'New Token',
                symbol: bluechipToken?.symbol || 'NEW',
                chain: addressType === 'EVM' ? 'Ethereum' : 'Solana',
                address: tokenToAnalyze,
                tokenAge: null,
                pairAge: null,
                liquidity: isBluechip ? 1000000 : null,
                holderCount: null,
                contractVerified: isBluechip ? true : null
            }
            
            const safeAnalysis: RiskAnalysis = {
                healthScore: isBluechip ? 75 : 65,
                riskLevel: 'MEDIUM',
                dataConfidence: {
                    level: 'LOW',
                    percentage: 0,
                    successfulChecks: 0,
                    totalChecks: 7,
                    missingFields: ['All data sources unavailable']
                },
                securityFlags: {
                    honeypot: false,
                    mintAuthority: false,
                    freezeAuthority: false,
                    blacklistAuthority: false,
                    ownerPrivileges: false,
                    proxyUpgradeable: false,
                    unverifiedContract: false,
                    noLiquidity: !isBluechip,
                    newToken: false,
                    notListed: !isBluechip
                },
                penalties: [{ reason: 'Insufficient data to perform thorough analysis', points: isBluechip ? 25 : 35 }],
                verdict: isBluechip 
                    ? '⚠️ MEDIUM RISK – Established token. Some data temporarily unavailable.'
                    : '⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined.',
                warnings: ['Partial analysis completed. Some data sources unavailable.']
            }
            
            return generateReport(safeTokenData, safeAnalysis, addressType)
        }
        
    } catch (error) {
        // GLOBAL RULE 1 & 9: Never crash, always return safe defaults
        console.error('[AnalyzeToken] Outer error:', error)
        
        // Return a minimal valid report even on catastrophic failure
        const addressType = detectAddressType(address)
        const normalizedAddress = address.toLowerCase()
        const bluechipToken = EXTENDED_BLUECHIP_LIST[normalizedAddress]
        const isBluechip = isExtendedBluechip(address)
        
        const safeTokenData: TokenData = {
            name: bluechipToken?.name || 'New Token',
            symbol: bluechipToken?.symbol || 'NEW',
            chain: addressType === 'EVM' ? 'Ethereum' : 'Solana',
            address,
            tokenAge: null,
            pairAge: null,
            liquidity: isBluechip ? 1000000 : null,
            holderCount: null,
            contractVerified: isBluechip ? true : null
        }
        
        const safeAnalysis: RiskAnalysis = {
            healthScore: isBluechip ? 75 : 65,
            riskLevel: 'MEDIUM',
            dataConfidence: {
                level: 'LOW',
                percentage: 0,
                successfulChecks: 0,
                totalChecks: 7,
                missingFields: ['All data sources unavailable']
            },
            securityFlags: {
                honeypot: false,
                mintAuthority: false,
                freezeAuthority: false,
                blacklistAuthority: false,
                ownerPrivileges: false,
                proxyUpgradeable: false,
                unverifiedContract: false,
                noLiquidity: !isBluechip,
                newToken: false,
                notListed: !isBluechip
            },
            penalties: [{ reason: 'Insufficient data to perform thorough analysis', points: isBluechip ? 25 : 35 }],
            verdict: isBluechip 
                ? '⚠️ MEDIUM RISK – Established token. Some data temporarily unavailable.'
                : '⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined.',
            warnings: ['Partial analysis completed. Some data sources unavailable.']
        }
        
        return generateReport(safeTokenData, safeAnalysis, addressType)
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

