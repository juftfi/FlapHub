import crypto from 'crypto';
import { createPublicClient, createWalletClient, http, formatEther, parseEther, keccak256, toHex, toBytes, concat } from 'viem';
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

  return { userId: data.id, username: data.username };
}

// Derive beneficiary address from Twitter user ID
function deriveBeneficiary(twitterUserId, privateKey) {
  const seed = keccak256(toHex(`flap-beneficiary-v1-${twitterUserId}`));
  const masterKeyBytes = toBytes(privateKey);
  const seedBytes = toBytes(seed);
  const derivedKey = keccak256(concat([masterKeyBytes, seedBytes]));
  const account = privateKeyToAccount(derivedKey);
  return { address: account.address, privateKey: derivedKey, account };
}

export default async function handler(req, res) {
  // Enable CORS with credentials
  // ⚠️ Update with your production domains!
  const allowedOrigins = ['https://yourdomain.com', 'https://www.yourdomain.com', 'http://localhost:8080'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const MASTER_KEY = process.env.MASTER_KEY;
  const PROJECT_WALLET = process.env.PROJECT_WALLET;
  const RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed1.binance.org';
  const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-key';

  if (!MASTER_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  if (!PROJECT_WALLET) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    // ⚠️ SECURITY: Get userId from verified session cookie, NOT from request body
    const cookies = req.headers.cookie || '';
    const verified = getVerifiedUserId(cookies, SESSION_SECRET);

    if (verified.error) {
      return res.status(401).json({ error: verified.error });
    }

    const userId = verified.userId;
    console.log(`[Claim] Verified user: ${verified.username} (${userId})`);

    // Get wallet address from request body (this is okay - user specifies where to send)
    const { walletAddress } = req.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Create clients
    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(RPC_URL),
    });

    // Derive beneficiary using verified userId
    const { address: beneficiaryAddress, privateKey: derivedKey } = deriveBeneficiary(userId, MASTER_KEY);
    const beneficiaryAccount = privateKeyToAccount(derivedKey);

    const walletClient = createWalletClient({
      account: beneficiaryAccount,
      chain: bsc,
      transport: http(RPC_URL),
    });

    // Get balance
    const balance = await publicClient.getBalance({
      address: beneficiaryAddress,
    });

    // Check minimum balance (need some for gas)
    const minBalance = parseEther('0.001');
    if (balance < minBalance) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        balance: formatEther(balance),
        minimum: '0.001'
      });
    }

    // Calculate shares: 2/3 to user, 1/3 to project
    const gasReserve = parseEther('0.0005'); // Reserve for gas
    const claimableBalance = balance - gasReserve;
    const userShare = (claimableBalance * 2n) / 3n;
    const projectShare = claimableBalance - userShare;

    // Send to user
    const userTxHash = await walletClient.sendTransaction({
      to: walletAddress,
      value: userShare,
    });

    // Wait for user tx
    await publicClient.waitForTransactionReceipt({ hash: userTxHash });

    // Send to project wallet
    let projectTxHash = null;
    if (projectShare > 0n) {
      projectTxHash = await walletClient.sendTransaction({
        to: PROJECT_WALLET,
        value: projectShare,
      });
      await publicClient.waitForTransactionReceipt({ hash: projectTxHash });
    }

    console.log(`[Claim] ✅ Success: ${formatEther(userShare)} BNB to ${walletAddress}`);

    res.json({
      success: true,
      claimed: {
        amount: formatEther(userShare),
        txHash: userTxHash,
        projectShare: formatEther(projectShare),
        projectTxHash,
      },
    });
  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ 
      error: 'Claim failed', 
      message: error.message 
    });
  }
}
