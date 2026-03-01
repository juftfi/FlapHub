# FlapX

**Create Tax Tokens via X (Twitter)**

Tweet a command → Get a token → Earn 2% tax on every trade.

Built on [Flap Protocol](https://flap.sh) • BNB Chain

## Features

- 🐦 **Twitter Integration** - Create tokens by tweeting `@YourBot create $SYMBOL`
- 💰 **3% Tax** - Automatic tax on every trade (2% to creator, 1% to platform)
- 🔐 **HD Wallet Derivation** - Unique tax receiver address per user (no database needed)
- 🖼️ **Auto Logo** - Uses tweet image or user avatar as token logo
- ⚡ **Vanity Addresses** - All tokens end in `7777`

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Frontend                              │
│                    (Vercel Serverless)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │  index.html │  │   app.js    │  │  /api/* (Serverless)│   │
│  │  styles.css │  │  config.js  │  │  - Twitter OAuth    │   │
│  └─────────────┘  └─────────────┘  │  - Session verify   │   │
│                                     │  - Claim earnings   │   │
│                                     └─────────────────────┘   │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                         Backend                               │
│                      (VPS / Server)                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Twitter Bot                            │ │
│  │  - Monitor @YourBot mentions                             │ │
│  │  - Parse create commands                                │ │
│  │  - Create tokens on BNB Chain                           │ │
│  │  - Reply with token link                                │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Token Creator                          │ │
│  │  - HD wallet derivation (unique address per user)       │ │
│  │  - Vanity salt generation (7777 suffix)                 │ │
│  │  - Flap Protocol integration                            │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   REST API Server                        │ │
│  │  - GET /api/user/tokens - List user's created tokens    │ │
│  │  - GET /health - Health check                           │ │
│  └─────────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────────┘
                             │ RPC
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      BNB Chain                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Flap Portal Contract                                    │ │
│  │  0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0             │ │
│  │  - newTokenV5() - Create tax tokens                     │ │
│  │  - 3% tax, auto-collected to beneficiary                │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Security Model

### HD Wallet Derivation (Anti-Fraud)

Each Twitter user gets a **unique, deterministic tax receiver address**:

```
DerivedKey = keccak256(MasterPrivateKey + keccak256("flap-beneficiary-v1-" + TwitterUserId))
BeneficiaryAddress = privateKeyToAccount(DerivedKey).address
```

**Benefits:**
- ✅ Same user always gets the same address
- ✅ No database needed to track ownership
- ✅ Only the backend can derive private keys
- ✅ Users can claim via verified Twitter login

### Claim Flow (Anti-Impersonation)

1. User logs in via Twitter OAuth 2.0 (PKCE)
2. Server creates signed HttpOnly session cookie
3. Claim API verifies session, extracts Twitter ID from cookie (NOT from request body)
4. Server derives beneficiary address from Twitter ID
5. Server transfers funds: 2/3 to user wallet, 1/3 to platform

**Key Security:**
- Session stored in HttpOnly cookie (not accessible by JavaScript)
- Twitter ID comes from verified session, not user input
- Private key encrypted with AES-256-GCM (PBKDF2-SHA256 key derivation)

## Quick Start

### Prerequisites

- Node.js 18+
- BNB for gas fees (~0.02 BNB per token creation)
- X (Twitter) API access
- Residential proxy (for Twitter login)

### Backend Setup

```bash
cd backend
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your values

# Encrypt your private key (recommended)
npm run encrypt-key

# Start the bot
npm start
```

### Frontend Setup (Vercel)

```bash
cd frontend

# Deploy to Vercel
vercel

# Set environment variables in Vercel dashboard
# See frontend/env.example for required variables
```

## Usage

### Create a Token

Tweet:
```
@YourBot create $MYTOKEN
```

The bot will:
1. Parse your command
2. Upload your avatar to IPFS
3. Create the token on BNB Chain
4. Reply with the token link

### Advanced: Gift Tax to Someone

```
@YourBot create $TOKEN Tax @friend
```

`@friend` will receive the 2% creator tax.

### Claim Earnings

1. Visit the website
2. Connect your Twitter account
3. Enter your BNB wallet address
4. Click "Claim All Earnings"

## Project Structure

```
├── backend/                 # Bot & API Server
│   ├── src/
│   │   ├── index.ts         # Main entry (Bot + API)
│   │   ├── twitter-bot.ts   # Twitter monitoring & replies
│   │   ├── token-creator.ts # Token creation & HD derivation
│   │   ├── keystore.ts      # Private key encryption
│   │   └── ...
│   ├── .env.example
│   └── package.json
│
├── frontend/                # Vercel Frontend
│   ├── api/                 # Serverless functions
│   │   ├── auth/            # Twitter OAuth
│   │   └── user/            # Earnings & Claims
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
└── docs/                    # Documentation
    └── ARCHITECTURE.md
```

## API Reference

### Backend API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/user/tokens` | GET | List all created tokens |

### Frontend API (Vercel)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/twitter` | GET | Initiate Twitter OAuth |
| `/api/auth/callback` | GET | OAuth callback |
| `/api/auth/session` | GET | Verify session |
| `/api/user/earnings` | GET | Get user earnings |
| `/api/user/claim` | POST | Claim earnings |

## Configuration

See `.env.example` for all configuration options.

Key settings:
- `KEY_PASSWORD` - Password for encrypted keystore
- `TWITTER_API_KEY` - X API key
- `TWITTER_OFFICIAL_USERNAME` - Bot account to monitor
- `TAX_RATE` - Tax rate in basis points (300 = 3%)

## Tech Stack

- **Backend:** Node.js, TypeScript, Express, Viem
- **Frontend:** Vanilla JS, CSS3
- **Blockchain:** BNB Chain, Flap Protocol
- **Authentication:** Twitter OAuth 2.0 (PKCE)
- **Storage:** IPFS (via Flap API)
- **Deployment:** Vercel (frontend), VPS (backend)

## Links

- 🌐 Website: [Your Domain](https://flaphub.vercel.app)
- 🐦 Twitter: [@YourBot](https://x.com/YourBot)
- 💬 Telegram: [Your Community](https://t.me/YourCommunity)
- 📜 Flap Protocol: [flap.sh](https://flap.sh)

## License

MIT
