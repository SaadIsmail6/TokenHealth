# TokenHealth v2.0 - Production Blockchain Security Analyzer

**A safety-first, multi-chain token security bot for Towns Protocol**

## 🎯 Core Philosophy

**SAFETY > ACCURACY > OPTIMISM**

TokenHealth v2.0 is built on the principle that **false safe is worse than false danger**. When data is missing, incomplete, or uncertain, the bot increases risk warnings rather than providing false reassurance.

---

## 🚀 Key Features

### Multi-Chain Support
- **EVM Chains**: Ethereum, BSC, Base, Arbitrum, Polygon, Optimism
- **Solana**: Limited analysis with clear disclaimers

### Advanced Security Analysis
- ✅ Honeypot detection (EVM only)
- ✅ Owner privilege scanning
- ✅ Mint/freeze authority checks (Solana)
- ✅ Liquidity verification
- ✅ Contract verification status
- ✅ Token age & pair age calculation
- ✅ Holder count analysis
- ✅ Market listing verification

### Data Confidence System
**NEW in v2.0**: Every report includes a Data Confidence score showing what percentage of security checks were successfully completed.

- **HIGH** (>80%): Full analysis available
- **MEDIUM** (40-80%): Some data missing
- **LOW** (<40%): Insufficient data for reliable analysis

### Safety-First Scoring
The scoring engine automatically:
- Caps scores when data is missing
- Forces MEDIUM/HIGH risk for new tokens
- Overrides scores when critical flags are detected
- Never shows "SAFE" when important data is unavailable

---

## 📊 How It Works

### 1. Address Detection
Automatically identifies if an address is EVM (0x...) or Solana (Base58) and routes to the appropriate analysis pipeline.

### 2. Multi-Source Data Fetching
For **EVM chains**:
- GoPlus Security API (honeypot, owner privileges)
- Chain-specific explorers (Etherscan, Basescan, etc.)
- Dexscreener (liquidity, pair age)
- CoinGecko (market data, listing status)

For **Solana**:
- Solscan API (mint/freeze authority, holders)
- Dexscreener (liquidity, pair age)

### 3. Confidence Calculation
Tracks which data sources succeeded and calculates a confidence percentage. Missing critical data automatically lowers the confidence score.

### 4. Security Flag Detection
Identifies critical risks:
- Honeypot behavior
- Dangerous owner privileges
- Active mint/freeze authorities
- Missing or low liquidity
- Unverified contracts
- Extremely new tokens (<24h)

### 5. Scoring Engine
Starts at 100 and applies penalties:
- Honeypot detected: **-50 points**
- Mint authority active: **-30 points**
- Owner privileges: **-30 points**
- No liquidity: **-25 points**
- Very new token (<24h): **-35 points**
- Unverified contract: **-15 points**
- Missing data: **-15 to -20 points**

**Override Rules**:
- Critical flags force HIGH risk regardless of score
- Missing data caps score at 55-60
- New tokens (<24h) capped at 40

### 6. Risk Level Determination
- **80-100**: LOW RISK (only if all data available and no critical flags)
- **60-79**: MEDIUM RISK
- **<60**: HIGH RISK

### 7. Verdict Generation
Rule-based verdicts provide specific, actionable feedback:
- "🔴 HIGH RISK – Honeypot behavior detected"
- "⚠️ INSUFFICIENT DATA – Risk cannot be accurately determined"
- "🟡 EARLY-STAGE TOKEN – Launch-phase rug risk"
- "🟢 NO CRITICAL RISKS DETECTED" (only when truly safe)

---

## 🛡️ Safety Features

### Missing Data Handling
**Never assumes safety from missing data.**

When critical fields cannot be fetched:
- Health Score capped at 60 maximum
- Risk Level set to at least MEDIUM
- Verdict warns about insufficient data

### New Token Detection
Tokens less than 24 hours old:
- Automatic HIGH RISK classification
- Score capped at 40
- Prominent rug risk warning

### Chain-Specific Logic
**EVM**: Full security suite including honeypot simulation

**Solana**: Limited analysis with clear disclaimers
- No honeypot detection
- Focus on mint/freeze authority
- Never shows "LOW RISK" without comprehensive data

### API Failure Handling
If APIs fail or rate limit:
- Automatic retry with backoff
- Missing data penalties applied
- Risk level increased, not decreased

---

## 🎮 Usage

### Slash Commands
```
/health <address>  - Analyze any token contract address
/help              - Show usage information
```

### Natural Language
The bot responds to mentions and safety queries:
- "TokenHealth check 0x..."
- "Is this token safe?"
- "Analyze this contract"

---

## 📋 Report Format

```
🩺 TokenHealth Report

Token: Example Token
Symbol: EXMPL
Chain: Ethereum
Address: `0x...`

Health Score: 75/100
Risk Level: ⚠️ MEDIUM
Data Confidence: HIGH (85%)

─────────── Security Checks ───────────

Honeypot Risk: ✅ None detected
Owner Privileges: ✅ Safe
Blacklist Function: ✅ None
Contract Verified: ✅ Yes
Proxy Upgradeable: ✅ No

Liquidity: $125,000
Token Age: 45 days
Holder Count: 1,250

─────────── Final Verdict ───────────

⚠️ REVIEW RECOMMENDED – Some risk factors detected.

⚠️ Token is less than 7 days old

─────────── Why this score? ───────────

• Very new token (<7 days) - elevated risk (−20 points)
• Some critical data unavailable (−10 points)

Not financial advice. Always DYOR.
TokenHealth provides information only and does not facilitate trading or gambling.
```

---

## 🔧 Configuration

### Required Environment Variables
```bash
# Towns Protocol (required)
APP_PRIVATE_DATA=your_private_key
JWT_SECRET=your_jwt_secret

# Block Explorer APIs (recommended)
ETHERSCAN_API_KEY=your_key
BASESCAN_API_KEY=your_key
ARBISCAN_API_KEY=your_key
BSCSCAN_API_KEY=your_key
POLYGONSCAN_API_KEY=your_key

# Solana (if analyzing Solana tokens)
SOLSCAN_API_KEY=your_key

# Server
PORT=auto  # Render auto-generates
```

---

## 📦 Deployment

### Local Development
```bash
cd TokenHealth
bun install
bun run dev
```

### Production (Render)
```bash
git push origin main
# Render automatically deploys from render.yaml
```

The bot automatically:
- Installs dependencies
- Starts the server
- Binds to Render's dynamic port
- Responds to Towns Protocol webhooks

---

## 🏗️ Architecture

### File Structure
```
TokenHealth/
├── src/
│   ├── index.ts      # Main bot logic (1200+ lines)
│   └── commands.ts   # Slash command definitions
├── package.json      # Dependencies & scripts
└── tsconfig.json     # TypeScript config

render.yaml           # Render deployment config
```

### Key Components

**Address Detection**: Validates EVM vs Solana addresses

**API Fetchers**: Parallel data fetching with retry logic

**Data Confidence System**: Tracks successful vs failed checks

**Security Flag Detector**: Identifies critical risk factors

**Scoring Engine**: Penalty-based system with overrides

**Risk Determinator**: Maps scores to risk levels with override rules

**Verdict Generator**: Rule-based verdict logic

**Report Formatter**: Structured, professional output

---

## 🎯 Design Principles

### 1. Safety-First
Missing data increases risk, never decreases it.

### 2. Transparency
Show exactly what was checked and what was missing.

### 3. Specificity
Provide actionable verdicts, not generic messages.

### 4. Multi-Source
Cross-verify data from multiple APIs when possible.

### 5. No False Reassurance
Only show "SAFE" when truly confident.

---

## 🐛 Error Handling

All API failures are handled gracefully:
- Automatic retries with exponential backoff
- Null checks on all data sources
- Missing data tracked in confidence score
- API failures result in higher risk, not lower

---

## 📝 Changelog

### v2.0.0 (Current)
- ✨ Data Confidence system
- ✨ Rule-based verdict engine
- ✨ Missing data penalty system
- ✨ Token age & pair age detection
- ✨ Enhanced Solana support
- ✨ CoinGecko integration
- ✨ Multi-source cross-verification
- 🔧 Redesigned scoring logic
- 🔧 Safety-first overrides
- 🔧 Professional field wording

### v1.0.0
- Basic EVM analysis
- GoPlus integration
- Dexscreener support
- Simple scoring

---

## ⚠️ Disclaimers

**NOT FINANCIAL ADVICE**
TokenHealth provides automated risk analysis for informational purposes only. Always do your own research before interacting with any token.

**READ-ONLY**
This bot never:
- Executes transactions
- Holds private keys
- Facilitates trading
- Accesses wallets

**LIMITATIONS**
- No blockchain can prevent all scams
- New attack vectors emerge constantly
- Some risks are not detectable on-chain
- Market conditions change rapidly

---

## 🤝 Support

Issues or questions? Check:
1. Environment variables are set correctly
2. API keys are valid and have credits
3. Render deployment logs for errors

---

## 📜 License

MIT License - See LICENSE file for details

---

**Built with safety in mind. 🛡️**
