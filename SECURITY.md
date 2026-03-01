# Security Model

## Overview

FlapX implements multiple security layers to protect user funds and prevent fraud.

## 1. HD Wallet Derivation (Unique Addresses)

Each Twitter user receives a unique, deterministic tax receiver address derived from the master key.

### How It Works

```javascript
// Derivation algorithm
const seed = keccak256("flap-beneficiary-v1-" + twitterUserId);
const derivedKey = keccak256(concat(masterKeyBytes, seedBytes));
const address = privateKeyToAccount(derivedKey).address;
```

### Security Properties

| Property | Description |
|----------|-------------|
| **Deterministic** | Same user ID → Same address (always) |
| **Unique** | Different users → Different addresses |
| **Non-reversible** | Cannot derive master key from derived key |
| **Verifiable** | Any party can verify the derivation |

### Benefits

- ✅ No database needed to track ownership
- ✅ Users cannot impersonate others
- ✅ All tokens for same user share one claim address
- ✅ Master key never leaves the server

## 2. Session Security (Anti-Impersonation)

Claims use Twitter OAuth 2.0 with secure session management.

### Session Flow

1. User initiates Twitter OAuth (PKCE flow)
2. Twitter validates credentials
3. Server creates signed session token
4. Token stored in HttpOnly cookie (not accessible by JS)
5. All API requests automatically include cookie
6. Server extracts user ID from **verified session only**

### Session Token Structure

```javascript
{
  data: {
    id: "twitter_user_id",
    username: "handle",
    avatar: "url",
    exp: timestamp
  },
  sig: HMAC-SHA256(data, serverSecret)
}
```

### Security Features

| Feature | Purpose |
|---------|---------|
| **HttpOnly Cookie** | Prevents XSS attacks |
| **Secure Flag** | HTTPS only |
| **SameSite=Lax** | Prevents CSRF attacks |
| **HMAC Signature** | Prevents tampering |
| **24h Expiration** | Limits session lifetime |

## 3. Claim Authorization

Claims never trust user-provided data.

### What We DO:
- ✅ Extract user ID from verified session cookie
- ✅ Derive beneficiary address server-side
- ✅ Verify session signature before any operation

### What We DON'T:
- ❌ Trust user ID from request body
- ❌ Trust user ID from URL parameters
- ❌ Allow claiming without valid session

### Claim Code Flow

```javascript
// Server-side claim handler
async function handleClaim(req) {
  // 1. Get session from cookie (NOT from body)
  const session = verifySession(req.cookies.flapx_session);
  if (!session) throw Error("Unauthorized");
  
  // 2. User ID comes from verified session
  const userId = session.data.id;
  
  // 3. Derive address server-side
  const { address, privateKey } = deriveBeneficiary(userId);
  
  // 4. Transfer funds
  // ...
}
```

## 4. Private Key Protection

Bot's master private key is encrypted at rest.

### Encryption Stack

| Layer | Algorithm | Parameters |
|-------|-----------|------------|
| Key Derivation | PBKDF2 | SHA-256, 100,000 iterations |
| Encryption | AES-256-GCM | 256-bit key, 128-bit IV |
| Authentication | GCM Auth Tag | 128-bit |

### Keystore File Structure

```json
{
  "version": 1,
  "crypto": {
    "cipher": "aes-256-gcm",
    "ciphertext": "...",
    "cipherparams": { "iv": "..." },
    "kdf": "pbkdf2",
    "kdfparams": {
      "dklen": 32,
      "salt": "...",
      "c": 100000,
      "prf": "hmac-sha256"
    },
    "mac": "..."
  }
}
```

### Usage

```bash
# Encrypt private key (one-time setup)
npm run encrypt-key

# Start bot (auto-decrypt with env var)
KEY_PASSWORD=yourpassword npm start

# Or enter password interactively
npm start
```

## 5. Rate Limiting

Prevents spam and abuse.

| Resource | Limit | Cooldown |
|----------|-------|----------|
| Token creation | 1 per user | 1 minute |
| Twitter polling | Every 5s | N/A |
| Reply attempts | 2 accounts | Rotating |

## 6. Input Validation

### Symbol Validation

```javascript
function validateSymbol(symbol) {
  // Length check (max 20 chars)
  if (symbol.length > 20) return false;
  
  // Byte check (max 32 bytes for UTF-8)
  if (Buffer.byteLength(symbol, 'utf8') > 32) return false;
  
  return true;
}
```

### Wallet Address Validation

```javascript
// Must be valid Ethereum address format
/^0x[a-fA-F0-9]{40}$/.test(walletAddress)
```

## Security Checklist

### Deployment

- [ ] Private key encrypted in keystore.json
- [ ] Environment variables set (not hardcoded)
- [ ] HTTPS enabled for all endpoints
- [ ] Residential proxy configured for Twitter
- [ ] VPS secured (SSH keys, firewall)

### Code Review

- [ ] No private keys in source code
- [ ] No API keys in source code
- [ ] No hardcoded wallet addresses
- [ ] User ID from session, not request body
- [ ] All inputs validated

### Operational

- [ ] Monitor for unusual activity
- [ ] Regular keystore backup (encrypted)
- [ ] Update dependencies regularly
- [ ] Review Twitter account security

## Reporting Vulnerabilities

If you discover a security vulnerability, please:

1. **Do NOT** create a public GitAgent issue
2. Contact the team directly via DM on Twitter
3. Allow reasonable time for a fix before disclosure

## Threat Model

### Threats Mitigated

| Threat | Mitigation |
|--------|------------|
| Impersonation (claim as other user) | Session-based auth, server-side ID extraction |
| Private key theft | AES-256-GCM encryption, never in memory plaintext |
| XSS attacks | HttpOnly cookies, no JS access to session |
| CSRF attacks | SameSite cookie attribute |
| Replay attacks | Session expiration |
| Brute force | Rate limiting, PBKDF2 iterations |

### Remaining Risks

| Risk | Severity | Notes |
|------|----------|-------|
| Server compromise | Critical | All user funds at risk |
| Master password leak | Critical | Decrypt keystore possible |
| Twitter API ban | High | Bot cannot operate |
| Flap protocol bug | Medium | Out of our control |
