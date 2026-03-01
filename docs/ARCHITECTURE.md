# FlapX Architecture

## System Overview

FlapX is a Twitter-powered token creation platform built on BNB Chain using the Flap Protocol.

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER FLOW                                │
└─────────────────────────────────────────────────────────────────┘

     ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
     │    User      │         │   FlapX      │         │   BNB Chain  │
     │  (Twitter)   │         │   Backend    │         │  (Flap)      │
     └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
            │                        │                        │
            │  @Bot create $TOKEN    │                        │
            │───────────────────────>│                        │
            │                        │                        │
            │                        │  Upload to IPFS        │
            │                        │───────────────────────>│
            │                        │<───────────────────────│
            │                        │  Metadata CID          │
            │                        │                        │
            │                        │  Create Token (TX)     │
            │                        │───────────────────────>│
            │                        │<───────────────────────│
            │                        │  Token Address         │
            │                        │                        │
            │  Reply: Token Created  │                        │
            │<───────────────────────│                        │
            │                        │                        │

```

## Security Architecture

### HD Wallet Derivation

Each Twitter user gets a unique, deterministic beneficiary address:

```
                    ┌─────────────────────────┐
                    │   Master Private Key     │
                    │   (Server Only)          │
                    └───────────┬─────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                     Derivation Function                      │
│                                                              │
│  seed = keccak256("flap-beneficiary-v1-" + twitterUserId)   │
│  derivedKey = keccak256(masterKey + seed)                   │
│  address = privateKeyToAccount(derivedKey).address          │
│                                                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │   Unique Beneficiary Address │
              │   (Per Twitter User)         │
              └─────────────────────────────┘
```

**Key Properties:**
- Deterministic: Same user ID always produces same address
- Unique: Different users get different addresses
- Secure: Only server with master key can derive private keys
- Verifiable: Address can be reproduced for verification

### Claim Security Flow

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│   User     │    │  Frontend  │    │   Vercel   │    │   Backend  │
│  Browser   │    │  (HTML/JS) │    │   (API)    │    │   (VPS)    │
└─────┬──────┘    └─────┬──────┘    └─────┬──────┘    └─────┬──────┘
      │                 │                 │                 │
      │  Click Login    │                 │                 │
      │────────────────>│                 │                 │
      │                 │                 │                 │
      │                 │  Redirect OAuth │                 │
      │                 │────────────────>│                 │
      │                 │                 │                 │
      │  Twitter Login  │                 │                 │
      │<─────────────────────────────────>│                 │
      │                 │                 │                 │
      │                 │  Set HttpOnly   │                 │
      │                 │  Session Cookie │                 │
      │<─────────────────────────────────│                 │
      │                 │                 │                 │
      │  Click Claim    │                 │                 │
      │────────────────>│                 │                 │
      │                 │                 │                 │
      │                 │  POST /claim    │                 │
      │                 │  (Cookie Auto)  │                 │
      │                 │────────────────>│                 │
      │                 │                 │                 │
      │                 │                 │  Verify Session │
      │                 │                 │  Extract UserID │
      │                 │                 │  (from cookie)  │
      │                 │                 │                 │
      │                 │                 │  Derive Address │
      │                 │                 │  Transfer Funds │
      │                 │                 │────────────────>│
      │                 │                 │                 │
      │  Success        │                 │                 │
      │<────────────────────────────────────────────────────│
      │                 │                 │                 │
```

**Security Features:**
1. **HttpOnly Cookie**: Session token not accessible by JavaScript
2. **Server-Side Verification**: User ID extracted from verified session
3. **No User Input**: Claim does not trust any user-provided ID
4. **Signed Session**: HMAC signature prevents tampering

### Private Key Protection

```
┌─────────────────────────────────────────────────────────────┐
│                    KEYSTORE ENCRYPTION                       │
│                                                              │
│  ┌─────────────┐     ┌─────────────────────────────────┐   │
│  │  Password   │────>│  PBKDF2-SHA256                  │   │
│  └─────────────┘     │  (100,000 iterations)           │   │
│                      │  + Random Salt (256-bit)         │   │
│                      └───────────────┬─────────────────┘   │
│                                      │                      │
│                                      ▼                      │
│                      ┌─────────────────────────────────┐   │
│  ┌─────────────┐     │  AES-256-GCM                    │   │
│  │ Private Key │────>│  + Random IV (128-bit)          │──>│ Keystore.json
│  └─────────────┘     │  + Auth Tag (128-bit)           │   │
│                      └─────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### Backend Components

| Component | File | Description |
|-----------|------|-------------|
| Main Entry | `index.ts` | Unified server (Bot + API) |
| Config | `config.ts` | Environment configuration |
| Twitter Bot | `twitter-bot.ts` | Mention monitoring & replies |
| Twitter API | `twitter-api.ts` | X API client |
| Token Creator | `token-creator.ts` | Token creation & HD derivation |
| Keystore | `keystore.ts` | Private key encryption |
| Token Store | `token-store.ts` | Local token data storage |
| IPFS | `ipfs.ts` | Image/metadata upload |

### Frontend Components

| Component | File | Description |
|-----------|------|-------------|
| Main Page | `index.html` | Landing page & UI |
| Styles | `styles.css` | CSS styling |
| App Logic | `app.js` | Frontend JavaScript |
| Config | `config.js` | Environment detection |
| OAuth Init | `api/auth/twitter.js` | Start Twitter OAuth |
| OAuth Callback | `api/auth/callback.js` | Handle OAuth response |
| Session | `api/auth/session.js` | Verify session |
| Earnings | `api/user/earnings.js` | Get user earnings |
| Claim | `api/user/claim.js` | Process claims |

## Data Flow

### Token Creation Flow

1. User tweets `@YourBot create $SYMBOL`
2. Bot detects mention via X API polling
3. Parse command, extract symbol and optional tax receiver
4. Get tax receiver's Twitter user ID
5. Derive unique beneficiary address from user ID
6. Upload avatar/tweet image to IPFS
7. Call Flap Portal `newTokenV5()` with:
   - Token name/symbol
   - Metadata CID
   - Tax rate (3%)
   - Beneficiary address
8. Wait for transaction confirmation
9. Save token record to local store
10. Reply to tweet with token link

### Tax Distribution

```
                   ┌────────────────────────┐
                   │     Trade Tax (3%)     │
                   └───────────┬────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │    Flap Protocol Auto-Collect  │
              │    to Beneficiary Address      │
              └────────────────┬───────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │    User Claims via Website     │
              └────────────────┬───────────────┘
                               │
              ┌────────────────┴───────────────┐
              │                                │
              ▼                                ▼
     ┌────────────────┐              ┌────────────────┐
     │  User Wallet   │              │ Project Wallet │
     │    (2/3)       │              │     (1/3)      │
     └────────────────┘              └────────────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        PRODUCTION                            │
└─────────────────────────────────────────────────────────────┘

     ┌───────────────────────────────────────────────┐
     │                   Vercel                       │
     │                                               │
     │  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
     │  │ Static  │  │Serverless│  │   CDN      │  │
     │  │  Files  │  │   API    │  │            │  │
     │  └─────────┘  └─────────┘  └─────────────┘  │
     │                                               │
     │  - index.html    - /api/auth/*               │
     │  - app.js        - /api/user/*               │
     │  - styles.css                                │
     └───────────────────────┬───────────────────────┘
                             │
                             │ HTTPS
                             ▼
     ┌───────────────────────────────────────────────┐
     │                    VPS                         │
     │                                               │
     │  ┌─────────────────────────────────────────┐ │
     │  │            Node.js Process              │ │
     │  │                                         │ │
     │  │  ┌──────────────┐  ┌──────────────┐   │ │
     │  │  │  Twitter Bot │  │  API Server  │   │ │
     │  │  └──────────────┘  └──────────────┘   │ │
     │  │                                         │ │
     │  │  Port 3001 (internal only)             │ │
     │  └─────────────────────────────────────────┘ │
     │                                               │
     │  - screen session for persistence            │
     │  - keystore.json (encrypted private key)     │
     └───────────────────────┬───────────────────────┘
                             │
                             │ RPC
                             ▼
     ┌───────────────────────────────────────────────┐
     │                BNB Chain                       │
     │                                               │
     │  Flap Portal: 0xe2cE...9De0                  │
     │                                               │
     └───────────────────────────────────────────────┘
```

## Rate Limiting

| Resource | Limit | Purpose |
|----------|-------|---------|
| Token creation per user | 1 per minute | Prevent spam |
| Twitter API polling | Every 5 seconds | Balance cost/responsiveness |
| Claim cooldown | None | Allow anytime claims |

## Error Handling

### Token Creation Errors

| Error Code | Meaning | User Message |
|------------|---------|--------------|
| `0xa7382e9b` | Symbol exists/invalid | "Symbol already exists" |
| Length > 20 | Symbol too long | "Max 20 characters" |
| Bytes > 32 | UTF-8 too long | "Symbol too long for Chinese" |

### Twitter Errors

| Error | Handling |
|-------|----------|
| 226 (Automation) | Rotate to backup account |
| 385 (Deleted tweet) | Skip reply |
| Auth failure | Clear cookie, re-login |
