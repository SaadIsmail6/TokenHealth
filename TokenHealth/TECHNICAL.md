# TokenHealth v2.0 - Technical Implementation Guide

## 🎯 Architecture Overview

TokenHealth v2.0 is a complete redesign implementing a **safety-first, production-grade** security analysis system. Every design decision prioritizes preventing false reassurance over providing optimistic assessments.

---

## 🏗️ System Architecture

### Component Pipeline

```
User Input
    ↓
Address Detection & Validation
    ↓
Chain Identification
    ↓
Parallel API Data Fetching (with retries)
    ↓
Data Confidence Calculation
    ↓
Security Flag Detection
    ↓
Penalty-Based Scoring
    ↓
Risk Level Determination (with overrides)
    ↓
Rule-Based Verdict Generation
    ↓
Structured Report Output
```

---

## 📊 Data Structures

### DataConfidence
Tracks analysis reliability based on successful data fetches:

```typescript
interface DataConfidence {
    level: 'HIGH' | 'MEDIUM' | 'LOW'
    percentage: number            // 0-100
    successfulChecks: number
    totalChecks: number
    missingFields: string[]       // Human-readable field names
}
```

**Calculation Logic:**
- HIGH: >80% of checks succeeded
- MEDIUM: 40-80% succeeded
- LOW: <40% succeeded

**Impact:**
- LOW confidence caps health score to 55
- MEDIUM confidence (if <60%) caps score to 60
- Forces minimum MEDIUM risk for LOW confidence

### SecurityFlags
Boolean flags for critical risk indicators:

```typescript
interface SecurityFlags {
    honeypot: boolean              // EVM: Can't sell after buying
    mintAuthority: boolean         // Solana: Can print unlimited tokens
    freezeAuthority: boolean       // Solana: Can freeze wallets
    blacklistAuthority: boolean    // EVM: Can blacklist addresses
    ownerPrivileges: boolean       // EVM: Can modify balances
    proxyUpgradeable: boolean      // EVM: Owner can change logic
    unverifiedContract: boolean    // EVM: Source not published
    noLiquidity: boolean           // No tradeable pool or <$1k
    newToken: boolean              // <7 days old
    notListed: boolean             // Not on DEXs/explorers
}
```

### TokenData
Aggregated token information from all sources:

```typescript
interface TokenData {
    name: string
    symbol: string
    chain: string
    address: string
    tokenAge: number | null        // Days since creation
    pairAge: number | null         // Days since first trading pair
    liquidity: number | null       // USD value
    holderCount: number | null
    contractVerified: boolean | null
    marketCap: number | null
    cmcRank: number | null
    cmcListed: boolean
}
```

### RiskAnalysis
Complete analysis result:

```typescript
interface RiskAnalysis {
    healthScore: number            // 0-100
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    dataConfidence: DataConfidence
    securityFlags: SecurityFlags
    penalties: Array<{ reason: string; points: number }>
    verdict: string
    warnings: string[]
}
```

---

## 🔍 Address Detection

### detectAddressType()
```typescript
function detectAddressType(address: string): 'EVM' | 'SOLANA' | 'UNKNOWN'
```

**EVM Detection:**
- Pattern: `^0x[a-fA-F0-9]{40}$`
- Exactly 42 characters
- Starts with "0x"
- Followed by 40 hex characters

**Solana Detection:**
- Pattern: `^[1-9A-HJ-NP-Za-km-z]{32,44}$`
- Base58 encoding
- 32-44 characters
- No confusing characters (0, O, I, l)
- Does not start with "0x"

**UNKNOWN:**
- Triggers immediate error response
- Risk Level: MEDIUM
- Prevents API calls with invalid addresses

### detectEVMChain()
```typescript
async function detectEVMChain(address: string): Promise<string>
```

**Detection Order:**
1. Try GoPlus API for each chain: eth, bsc, base, arbitrum, polygon, optimism
2. First successful response determines chain
3. Fallback to "Ethereum" if all fail

**Why This Matters:**
- Ensures correct explorer API is used
- Prevents querying wrong blockchain
- Critical for accurate contract verification

---

## 📡 API Integration

### Retry Logic
All API calls use `fetchWithRetry()`:

```typescript
async function fetchWithRetry<T>(
    fetchFn: () => Promise<T>,
    retries: number = 2,
    delayMs: number = 1000
): Promise<T | null>
```

**Behavior:**
- 2 retries by default
- Exponential backoff: 1s, 2s, 3s
- Returns `null` on failure (never throws)
- Failures tracked in confidence score

### Data Sources

#### EVM Chains

**GoPlus Security API**
- Purpose: Honeypot detection, owner privileges
- Endpoint: `/api/v1/token_security/{chainId}`
- Data: `is_honeypot`, `buy_tax`, `sell_tax`, `owner_change_balance`, `is_blacklisted`
- Retry: Yes
- Failure Impact: -25 points, confidence penalty

**Block Explorer APIs** (Etherscan, Basescan, etc.)
- Purpose: Contract verification, creation data
- Endpoints: `getsourcecode`, `getcontractcreation`
- Data: `SourceCode`, `ContractName`, `txHash`, `blockNumber`
- Requires: API keys
- Failure Impact: Unverified penalty (-15 points)

**Dexscreener**
- Purpose: Liquidity, pair age, volume
- Endpoint: `/latest/dex/tokens/{address}`
- Data: `liquidity.usd`, `pairCreatedAt`, `txns.h24`, `volume.h24`
- No auth required
- Failure Impact: No liquidity penalty (-25 points)

**CoinGecko**
- Purpose: Market data, listing status, genesis date
- Endpoint: `/api/v3/coins/{platform}/contract/{address}`
- Data: `name`, `symbol`, `market_cap`, `genesis_date`, `market_cap_rank`
- No auth required
- Failure Impact: Age unknown penalty (-15 points)

#### Solana

**Solscan API**
- Purpose: Mint/freeze authority, holder count, metadata
- Endpoints: `/v1.0/token/meta`, `/v1.0/token/holders`
- Data: `mintAuthority`, `freezeAuthority`, `holderCount`, `supply`
- Requires: API key
- Failure Impact: Forces LIMITED ANALYSIS verdict

**Dexscreener** (same as EVM)
- Purpose: Liquidity and pair age for Solana tokens

---

## 🧮 Scoring System

### Base Score: 100

### Penalty Table

| Condition | Points Deducted | Reason |
|-----------|----------------|---------|
| Honeypot detected | -50 | Cannot sell after buying |
| Mint authority active | -30 | Unlimited token printing |
| Owner privileges | -30 | Can modify balances |
| No liquidity | -25 | Cannot trade |
| Freeze authority | -25 | Can freeze wallets |
| New token (<24h) | -35 | Extreme rug risk |
| New token (<7d) | -20 | Elevated rug risk |
| Blacklist function | -20 | Can block addresses |
| Token age unknown | -15 | Cannot verify launch |
| Unverified contract | -15 | Can't audit code |
| Not listed | -15 | No market presence |
| Solana limited mode | -15 | Reduced checks |
| Low data confidence | -20 | Incomplete analysis |
| Medium data confidence | -10 | Some data missing |

### Score Caps (Override System)

**Confidence-Based:**
- Data Confidence LOW → Max score: **55**
- Data Confidence MEDIUM (<60%) → Max score: **60**

**Age-Based:**
- Token age <24 hours → Max score: **40**
- Token age <7 days → Max score: **65**

**Example:**
```
Starting score: 100
- Unverified contract: -15
- New token (3 days old): -20
- Low liquidity: -25
Calculated: 40

But token is <7 days old, so cap at 65
And confidence is MEDIUM, so cap at 60

Final score: 40 (lowest cap wins)
```

---

## 🚦 Risk Level Determination

### Base Mapping
- 80-100 → LOW
- 60-79 → MEDIUM
- <60 → HIGH

### Override Rules (Applied BEFORE mapping)

**Force HIGH Risk:**
- `honeypot` flag set
- `mintAuthority` flag set
- `ownerPrivileges` flag set
- Data confidence = LOW

**Force MEDIUM Risk (minimum):**
- Data confidence = MEDIUM AND score < 70

**Example:**
```
Score: 75 (would be MEDIUM)
But mintAuthority: true
→ Override to HIGH

Score: 85 (would be LOW)
But dataConfidence: LOW
→ Override to HIGH
```

---

## 📝 Verdict Generation

### Rule-Based System

The verdict engine checks conditions in **priority order**:

1. **Honeypot** → "🔴 HIGH RISK – Honeypot behavior detected. Do NOT interact."
2. **Mint Authority** → "🔴 HIGH RISK – Token supply can be inflated at any time."
3. **Owner Privileges** → "🔴 HIGH RISK – Dangerous owner privileges detected."
4. **Low Data Confidence** → "⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined."
5. **Very New Token** (<24h) → "🟡 EARLY-STAGE TOKEN – Launch-phase rug risk."
6. **No Liquidity** → "🔴 HIGH RISK – No active liquidity pool detected."
7. **Solana Limited** → "⚠️ LIMITED SOLANA ANALYSIS – Manual review required."
8. **General HIGH** → "🔴 HIGH RISK – Multiple risk factors detected."
9. **General MEDIUM** → "⚠️ REVIEW RECOMMENDED – Some risk factors detected."
10. **LOW (only if all safe)** → "🟢 NO CRITICAL RISKS DETECTED"

### LOW RISK Requirements (ALL must be true)
- Data Confidence = HIGH
- No honeypot
- No mint authority
- No owner privileges
- Liquidity present
- Token age known AND ≥7 days

**If ANY is false → MEDIUM or HIGH**

---

## 🕐 Token Age Calculation

### Priority Order (first success wins)

1. **Whitelist Check**
   - Predefined ages for WETH, USDC, USDT, WBTC
   - Instant, no API calls

2. **CoinGecko Genesis Date**
   - `genesis_date` field
   - Most reliable for listed tokens
   - Calculate: `(now - genesisTime) / (1000 * 60 * 60 * 24)`

3. **Dexscreener Pair Age**
   - `pairCreatedAt` timestamp
   - Approximates token launch
   - Good for new/unlisted tokens

4. **Explorer Creation Block**
   - Contract deployment block number
   - Estimate: `(currentBlock - creationBlock) / blocksPerDay`
   - EVM only, approximate

5. **Return null**
   - Triggers "Age unknown" penalty (-15 points)
   - Prevents assuming old = safe

---

## 📊 Data Confidence Calculation

### EVM Checks (7 total)
1. Token Age available
2. Liquidity detected
3. Contract Verification status
4. Holder Count available
5. Honeypot Check (GoPlus)
6. Owner Privileges (GoPlus)
7. Explorer Data fetched

### Solana Checks (5 total)
1. Token Age available
2. Liquidity detected
3. Holder Count available
4. Mint Authority status
5. Freeze Authority status

### Example Calculation
```
EVM Token:
- Token Age: ✅
- Liquidity: ✅
- Contract Verified: ✅
- Holder Count: ❌
- Honeypot Check: ✅
- Owner Privileges: ✅
- Explorer Data: ❌

Successful: 5/7 = 71%
Level: MEDIUM
Missing: ["Holder Count", "Explorer Data"]
```

---

## 🛡️ Security Flag Detection

### Honeypot Detection (EVM)
```typescript
honeypot: goPlusData?.is_honeypot === '1' ||
          goPlusData?.buy_tax > 50 ||
          goPlusData?.sell_tax > 50 ||
          goPlusData?.cannot_sell_all === '1'
```

**Triggers:**
- GoPlus flags it
- Buy tax >50%
- Sell tax >50%
- Cannot sell all tokens

### Owner Privileges (EVM)
```typescript
ownerPrivileges: goPlusData?.owner_change_balance === '1' ||
                 goPlusData?.hidden_owner === '1' ||
                 goPlusData?.selfdestruct === '1'
```

**Triggers:**
- Can change balances
- Hidden owner
- Self-destruct capability

### Mint/Freeze Authority (Solana)
```typescript
mintAuthority: solscanData?.mintAuthority !== null
freezeAuthority: solscanData?.freezeAuthority !== null
```

**Safe State:**
- Both should be `null` (disabled)
- If present → authority can be used

### New Token
```typescript
newToken: tokenAge !== null && tokenAge < 7
```

**Special Handling:**
- <24h: Score capped at 40, forces HIGH
- <7d: Score capped at 65, likely MEDIUM

---

## 📄 Report Structure

### Header
```
🩺 TokenHealth Report

Token: Wrapped Ether
Symbol: WETH
Chain: Ethereum
Address: `0x...`
```

### Scores
```
Health Score: 85/100
Risk Level: 🟢 LOW
Data Confidence: HIGH (100%)
```

### Security Checks (EVM)
```
─────────── Security Checks ───────────

Honeypot Risk: ✅ None detected
Owner Privileges: ✅ Safe
Blacklist Function: ✅ None
Contract Verified: ✅ Yes
Proxy Upgradeable: ✅ No

Liquidity: $1,250,000
Token Age: 2500 days
Holder Count: 450,000
CMC Listing: ✅ Listed (Rank #10)
```

### Security Checks (Solana)
```
─────────── Security Checks ───────────

Mint Authority: ✅ Disabled
Freeze Authority: ✅ Disabled
Honeypot Risk: ⚠️ Not supported on Solana
Contract Verified: ⚠️ Not applicable on Solana

Liquidity: $50,000
Token Age: 45 days
Holder Count: 1,250
```

### Missing Data (if any)
```
⚠️ Missing / Unavailable Data:
  • Token age
  • Holder count
```

### Verdict
```
─────────── Final Verdict ───────────

🟢 NO CRITICAL RISKS DETECTED – Token appears relatively safe.

⚠️ Always DYOR - this is not financial advice
```

### Penalties
```
─────────── Why this score? ───────────

• Unverified contract (-15 points)
• Very new token (<7 days) (-20 points)
• Some critical data unavailable (-10 points)
```

### Footer
```
Not financial advice. TokenHealth provides automated risk analysis only. Always DYOR.
TokenHealth provides information only and does not facilitate trading or gambling.
```

---

## 🔄 Error Handling Philosophy

### Principle: Fail Secure

When APIs fail or data is missing:
1. **Track it** → Add to `missingFields`
2. **Penalize it** → Deduct points
3. **Cap score** → Enforce maximums
4. **Raise risk** → Never lower it
5. **Warn user** → Be explicit

### Example Flow
```
GoPlus API fails (rate limit)
    ↓
goPlusData = null
    ↓
Cannot check honeypot → missingFields += "Honeypot Check"
    ↓
Score penalty: -25 points
    ↓
Confidence: MEDIUM or LOW
    ↓
Risk Level: At least MEDIUM
    ↓
Verdict: "⚠️ INSUFFICIENT DATA"
```

**NEVER:**
- Assume safe because API failed
- Hide missing data
- Lower risk due to failures

---

## 🎯 Key Design Decisions

### 1. Null Safety
All data sources can return `null`. Every field is nullable. Never assume success.

### 2. Parallel Fetching
```typescript
const [goPlus, explorer, dex, cg] = await Promise.all([...])
```
Minimizes latency but handles individual failures.

### 3. Type Safety
TypeScript interfaces for all data structures. Prevents runtime errors.

### 4. Penalty Transparency
Users see exactly why points were deducted. Builds trust.

### 5. Override System
Critical flags override score-based risk levels. Safety > math.

### 6. Confidence Tracking
Novel feature: Show users how reliable the analysis is.

### 7. Chain-Specific Logic
Different checks for EVM vs Solana. No false equivalence.

### 8. Whitelist for Performance
Well-known tokens skip API calls. Instant results.

---

## 🚀 Performance Optimizations

1. **Parallel API Calls**
   - All sources fetched simultaneously
   - Reduces total latency to slowest API

2. **Whitelist Cache**
   - WETH, USDC, etc. return instantly
   - No API calls needed

3. **Early Returns**
   - Unknown address type → immediate error
   - No wasted API calls

4. **Retry with Backoff**
   - Exponential delays prevent hammering
   - Respects rate limits

---

## 📈 Future Enhancements

### Potential Additions
- ✅ DeFi protocol integration checks
- ✅ Historical rug pull database
- ✅ Social media sentiment analysis
- ✅ Whale wallet tracking
- ✅ Audit report integration
- ✅ Cross-chain bridge verification

### Explicitly NOT Adding
- ❌ Price predictions
- ❌ Trading signals
- ❌ Portfolio management
- ❌ Transaction execution
- ❌ Wallet integration

**Reason:** Maintains read-only, informational focus.

---

## 🧪 Testing Scenarios

### Must Pass Tests

1. **Honeypot Token**
   - Should return HIGH RISK
   - Score ≤50
   - Specific verdict about honeypot

2. **New Token (<24h)**
   - Should cap score at 40
   - HIGH RISK
   - Launch-phase warning

3. **Missing Data**
   - Should show INSUFFICIENT DATA
   - Score ≤60
   - List missing fields

4. **API Failure**
   - Should not crash
   - Should warn about unavailable data
   - Should increase risk

5. **Well-Known Token (WETH)**
   - Should return LOW RISK
   - High score (>80)
   - Fast response

6. **Solana Token**
   - Never show LOW RISK without full data
   - Check mint/freeze authority
   - Clear limitations disclaimer

7. **Unverified Contract**
   - Penalty applied
   - Warning shown
   - Risk elevated

---

## 📚 Code Quality

### Metrics
- **Lines of Code:** ~1,200
- **Functions:** 15+
- **Type Interfaces:** 4 primary
- **API Integrations:** 6 sources
- **Error Handlers:** All async functions
- **Retry Logic:** All API calls
- **Null Checks:** Comprehensive

### Best Practices
✅ TypeScript strict mode
✅ Async/await (no callbacks)
✅ Interface-driven design
✅ Single responsibility functions
✅ Meaningful variable names
✅ Comprehensive error handling
✅ No magic numbers (constants defined)
✅ Commented complex logic

---

## 🎓 Lessons Learned

### What Works
1. **Data Confidence** - Users appreciate transparency
2. **Penalty Transparency** - Shows why score is what it is
3. **Override System** - Math shouldn't override critical flags
4. **Multi-Source** - Cross-verification catches issues
5. **Null Safety** - Prevents crashes, forces handling

### What to Avoid
1. **False Reassurance** - Never assume safe from missing data
2. **Generic Messages** - "Unable to verify" is useless
3. **Score-Only Logic** - Need overrides for critical risks
4. **Single API** - Always have fallbacks
5. **Optimistic Defaults** - Default to caution

---

**This is production-grade security software. Every line matters. 🛡️**












