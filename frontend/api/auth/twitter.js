import crypto from 'crypto';

// Store states temporarily (Vercel has built-in edge caching)
const states = new Map();

export default function handler(req, res) {
  const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
  // ⚠️ Set in Vercel environment variables!
  const TWITTER_CALLBACK_URL = process.env.TWITTER_CALLBACK_URL || 'https://yourdomain.com/api/auth/callback';

  if (!TWITTER_CLIENT_ID) {
    return res.status(500).json({ error: 'Twitter OAuth not configured' });
  }

  // Generate PKCE values
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  // Store verifier in cookie (secure way for serverless)
  res.setHeader('Set-Cookie', `oauth_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: TWITTER_CALLBACK_URL,
    scope: 'tweet.read users.read offline.access',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  
  res.redirect(307, authUrl);
}
