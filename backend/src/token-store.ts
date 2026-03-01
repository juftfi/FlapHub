/**
 * Token Store - Interface for token storage
 * 
 * Implement your own storage backend (database, file system, etc.)
 */

export interface TokenRecord {
  symbol: string;
  name: string;
  address: string;
  taxReceiver: string;
  taxReceiverId: string;
  beneficiaryAddress: string;
  tweetId: string;
  tweetUrl: string;
  createdAt: string;
  txHash: string;
}

// In-memory store (replace with database in production)
let tokens: TokenRecord[] = [];

/**
 * Load all tokens from the store
 */
export function loadTokens(): TokenRecord[] {
  // TODO: Implement your storage backend
  // Example: return await db.query('SELECT * FROM tokens')
  return tokens;
}

/**
 * Save a new token to the store
 */
export function saveToken(token: TokenRecord): void {
  // TODO: Implement your storage backend
  // Example: await db.insert('tokens', token)
  
  // Check if token already exists
  const exists = tokens.some(t => t.address.toLowerCase() === token.address.toLowerCase());
  if (!exists) {
    tokens.push(token);
    console.log(`[TokenStore] Saved token ${token.symbol}`);
  }
}

/**
 * Get all tokens for a specific tax receiver (by Twitter user ID)
 */
export function getTokensByTaxReceiver(taxReceiverId: string): TokenRecord[] {
  return loadTokens().filter(t => t.taxReceiverId === taxReceiverId);
}

/**
 * Get token count
 */
export function getTokenCount(): number {
  return loadTokens().length;
}
