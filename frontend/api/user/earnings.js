import crypto from 'crypto';
import { createPublicClient, http, formatEther, keccak256, toHex, toBytes, concat } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Verify HMAC signature for session data
function verifySession(data, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(data));
  const expectedSignature = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

// Get verified user ID from session cookie
function getVerifiedUserId(cookies, secret) {
  const sessionMatch = cookies.match(/flapx_session=([^;]+)/);
  const sessionToken = sessionMatch ? sessionMatch[1] : null;

  if (!sessionToken) {
    return { error: 'Not authenticated' };
  }

  let sessionPayload;
  try {
    sessionPayload = JSON.parse(Buffer.from(sessionToken, 'base64url').toString());
  } catch (e) {
    return { error: 'Invalid session' };
  }

  const { data, sig } = sessionPayload;

  if (!data || !sig) {
    return { error: 'Invalid session format' };
  }

  // Verify signature
  if (!verifySession(data, sig, secret)) {
    return { error: 'Session signature invalid' };
  }

  // Check expiration
  if (data.exp && Date.now() > data.exp) {
    return { error: 'Session expired' };
  }

  return { userId: data.id, username: data.username, avatar: data.avatar };
}

// Derive beneficiary address from Twitter user ID
function deriveBeneficiary(twitterUserId, privateKey) {
  const seed = keccak256(toHex(`flap-beneficiary-v1-${twitterUserId}`));
  const masterKeyBytes = toBytes(privateKey);
  const seedBytes = toBytes(seed);
  const derivedKey = keccak256(concat([masterKeyBytes, seedBytes]));
  const account = privateKeyToAccount(derivedKey);
  return { address: account.address, privateKey: derivedKey };
}

export default async function handler(req, res) {
  // Enable CORS with credentials
  // ⚠️ Update with your production domains!
  const allowedOrigins = ['https://flaphub.vercel.app', 'https://www.flaphub.vercel.app', 'http://localhost:8080'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const MASTER_KEY = process.env.MASTER_KEY;
  const RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed1.binance.org';
  const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-key';

  if (!MASTER_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    // ⚠️ SECURITY: Get userId from verified session cookie, NOT from query params
    const cookies = req.headers.cookie || '';
    const verified = getVerifiedUserId(cookies, SESSION_SECRET);

    if (verified.error) {
      return res.status(401).json({ error: verified.error });
    }

    const userId = verified.userId;

    // Create client
    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(RPC_URL),
    });

    // Derive beneficiary address using verified userId
    const { address: beneficiaryAddress } = deriveBeneficiary(userId, MASTER_KEY);

    // Get BNB balance
    const balance = await publicClient.getBalance({
      address: beneficiaryAddress,
    });

    // Calculate user's share (2/3)
    const userShare = (balance * 2n) / 3n;
    const userShareBNB = formatEther(userShare);

    // BNB price (simplified)
    const bnbPrice = 600;
    const userShareUSD = parseFloat(userShareBNB) * bnbPrice;

    res.json({
      success: true,
      user: {
        id: verified.userId,
        userName: verified.username,
        avatar: verified.avatar,
      },
      earnings: {
        totalBNB: formatEther(balance),
        claimableBNB: userShareBNB,
        claimableUSD: userShareUSD.toFixed(2),
        // Don't expose beneficiary address to frontend
      },
    });
  } catch (error) {
    console.error('Earnings error:', error);
    res.status(500).json({ error: 'Failed to get earnings', message: error.message });
  }
}
