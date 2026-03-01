/**
 * FlapX Frontend Application
 * Handles Twitter OAuth, earnings display, and claim functionality
 * 
 * SECURITY: User authentication is verified via secure HttpOnly cookies
 * - Session cookie is set by server after OAuth verification
 * - All API calls use credentials: 'include' to send cookies
 * - User data comes from verified session, NOT from URL parameters
 */

// Load configuration from config.js (must be loaded before this script)
// ⚠️ Update config.js with your production domain
const API_BASE = (window.FLAPX_CONFIG && window.FLAPX_CONFIG.API_BASE) || '/api';
const LOCAL_API_BASE = window.FLAPX_CONFIG && window.FLAPX_CONFIG.LOCAL_API_BASE; // null in production
// ⚠️ Update BOT_USERNAME in config.js
const BOT_USERNAME = (window.FLAPX_CONFIG && window.FLAPX_CONFIG.BOT_USERNAME) || 'YourBot';

// State
let currentUser = null;

// ============================================
// UI Helper Functions
// ============================================

function showNotification(message, type = 'info') {
  // Remove existing notification
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;
  document.body.appendChild(notification);
  
  // Auto remove after 5 seconds
  setTimeout(() => notification.remove(), 5000);
}

function showLoading(element, text = 'Loading...') {
  element.disabled = true;
  element.dataset.originalText = element.innerHTML;
  element.innerHTML = `<span class="spinner"></span> ${text}`;
}

// Copy token address to clipboard
function copyTokenAddress() {
  const addressEl = document.getElementById('exampleTokenAddress');
  const fullAddress = addressEl?.dataset.full || '7777';
  
  navigator.clipboard.writeText(fullAddress).then(() => {
    // Visual feedback
    const btn = document.querySelector('.copy-address-btn');
    if (btn) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    }
    showNotification('Address copied!', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showNotification('Failed to copy address', 'error');
  });
}

function hideLoading(element) {
  element.disabled = false;
  element.innerHTML = element.dataset.originalText || element.innerHTML;
}

// ============================================
// Authentication Functions (SECURE)
// ============================================

/**
 * Check session by calling the session API
 * This verifies the secure HttpOnly cookie on the server
 * User data is returned from the verified session, NOT from URL/localStorage
 */
async function checkSession() {
  try {
    const response = await fetch(`${API_BASE}/auth/session`, {
      method: 'GET',
      credentials: 'include', // IMPORTANT: Send cookies
    });
    
    if (!response.ok) {
      // Session invalid or expired
      currentUser = null;
      localStorage.removeItem('flapx_user'); // Clear any cached user data
      return false;
    }
    
    const data = await response.json();
    
    if (data.success && data.user) {
    currentUser = data.user;
      // Cache user data for UI (but authentication still verified via cookie)
      localStorage.setItem('flapx_user', JSON.stringify(currentUser));
    return true;
    }
    
    return false;
  } catch (error) {
    console.error('Session check failed:', error);
    currentUser = null;
    return false;
  }
}

function connectTwitter() {
  // Redirect to Twitter OAuth - server will set secure cookie after verification
  window.location.href = `${API_BASE}/auth/twitter`;
}

async function handleLogout() {
  // Clear local state
  currentUser = null;
  localStorage.removeItem('flapx_user');
  
  // Server-side logout would clear the cookie, but cookies are HttpOnly
  // The cookie will expire naturally or user can clear browser cookies
  
  updateUI();
  showNotification('Logged out successfully', 'info');
}

// ============================================
// URL Parameter Handler (OAuth Callback)
// ============================================

/**
 * Handle OAuth callback
 * SECURITY: We only check for login=success or error flags
 * User data is NOT taken from URL - it's verified via session API
 */
function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  
  // Check for login success
  const loginStatus = params.get('login');
  if (loginStatus === 'success') {
    // Clean URL immediately
    window.history.replaceState({}, document.title, window.location.pathname);
    // Session will be verified by checkSession() via secure cookie
    return { success: true };
  }
  
  // Check for errors
  const error = params.get('error');
  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    const errorMessages = {
      'access_denied': 'Authorization was denied',
      'invalid_state': 'Invalid session state',
      'token_exchange_failed': 'Failed to authenticate',
      'user_info_failed': 'Failed to get user info',
      'callback_failed': 'Authentication failed',
      'missing_verifier': 'Session expired, please try again',
      'missing_code': 'Authorization code missing',
    };
    showNotification(errorMessages[error] || 'Authentication failed', 'error');
    return { error: true };
  }
  
  return { none: true };
}

// ============================================
// Earnings Functions (SECURE)
// ============================================

/**
 * Load earnings - uses secure cookie for authentication
 * Server verifies the session and uses userId from the verified token
 */
async function loadEarnings() {
  if (!currentUser) return;
  
  const earningsValue = document.getElementById('earningsValue');
  const earningsUsd = document.getElementById('earningsUsd');
  
  try {
    const response = await fetch(`${API_BASE}/user/earnings`, {
      method: 'GET',
      credentials: 'include', // IMPORTANT: Send session cookie
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 401) {
        // Session expired - clear user state
        currentUser = null;
        localStorage.removeItem('flapx_user');
        updateUI();
        return;
      }
      throw new Error(data.error || 'Failed to load earnings');
    }
    
    if (earningsValue) {
      earningsValue.textContent = `${parseFloat(data.earnings.claimableBNB).toFixed(6)} BNB`;
    }
    if (earningsUsd) {
      earningsUsd.textContent = `≈ $${data.earnings.claimableUSD}`;
    }
    
    // Enable/disable claim button
    const claimBtn = document.getElementById('claimBtn');
    if (claimBtn) {
      const hasEarnings = parseFloat(data.earnings.claimableBNB) >= 0.001;
      const hasWallet = currentUser && currentUser.walletAddress;
      claimBtn.disabled = !hasEarnings || !hasWallet;
    }
  } catch (error) {
    console.error('Failed to load earnings:', error);
  }
}

/**
 * Load user's tokens from LOCAL API (requires local server running)
 * Tokens are fetched from local data store, not Vercel
 * In production (LOCAL_API_BASE is null), this function is skipped
 */
async function loadTokens() {
  if (!currentUser || !currentUser.id) return;
  
  // Skip if LOCAL_API_BASE is not configured (production environment)
  if (!LOCAL_API_BASE) {
    console.log('[Tokens] Local API not configured, skipping token list');
    return;
  }
  
  const tokensList = document.getElementById('tokensList');
  const tokensCount = document.getElementById('tokensCount');
  const tokensSection = document.getElementById('tokensSection');
  
  try {
    const response = await fetch(`${LOCAL_API_BASE}/user/tokens?userId=${currentUser.id}&userName=${currentUser.userName}`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load tokens');
    }
    
    if (tokensSection) {
      tokensSection.style.display = 'block';
    }
    
    if (tokensCount) {
      tokensCount.textContent = `${data.totalTokens} token${data.totalTokens !== 1 ? 's' : ''}`;
    }
    
    if (tokensList) {
      if (data.tokens.length === 0) {
        tokensList.innerHTML = `
          <div class="tokens-empty">
            <p>No tokens yet</p>
            <p style="font-size: 11px; margin-top: 8px;">Tweet <code>@${BOT_USERNAME} create $SYMBOL</code> to create one!</p>
          </div>
        `;
      } else {
        tokensList.innerHTML = data.tokens.map(token => `
          <div class="token-item">
            <span class="token-symbol">$${token.symbol}</span>
            <span class="token-address">${token.address.slice(0, 8)}...${token.address.slice(-6)}</span>
            <div class="token-links">
              <a href="${token.flapUrl}" target="_blank" class="token-link" title="View on Flap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
              <a href="${token.bscscanUrl}" target="_blank" class="token-link" title="View on BscScan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </a>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (error) {
    console.error('Failed to load tokens:', error);
    if (tokensSection) {
      tokensSection.style.display = 'none';
    }
  }
}

// ============================================
// Wallet Functions
// ============================================

async function handleSetWallet(event) {
  event.preventDefault();
  
  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const walletInput = form.walletAddress;
  const walletAddress = walletInput.value.trim();
  
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    showNotification('Please enter a valid BNB wallet address', 'error');
    return;
  }
  
  showLoading(submitBtn, '');
  
  try {
    // Save wallet locally (validation happens on claim)
    currentUser.walletAddress = walletAddress;
    localStorage.setItem('flapx_user', JSON.stringify(currentUser));
    
    updateUI();
    showNotification('Wallet address saved!', 'success');
    
    // Refresh to enable claim button
    loadEarnings();
  } catch (error) {
    showNotification(error.message || 'Failed to save wallet', 'error');
  } finally {
    hideLoading(submitBtn);
  }
}

// ============================================
// Claim Functions (SECURE)
// ============================================

/**
 * Handle claim - uses secure cookie for authentication
 * Server verifies the session and uses userId from the verified token
 * Only wallet address comes from user input
 */
async function handleClaim() {
  const claimBtn = document.getElementById('claimBtn');
  
  if (!currentUser) {
    showNotification('Please login first', 'error');
    return;
  }
  
  if (!currentUser.walletAddress) {
    showNotification('Please set your wallet address first', 'error');
    return;
  }
  
  showLoading(claimBtn, 'Claiming...');
  
  try {
    const response = await fetch(`${API_BASE}/user/claim`, {
      method: 'POST',
      credentials: 'include', // IMPORTANT: Send session cookie for verification
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Only send wallet address - userId is taken from verified session on server
        walletAddress: currentUser.walletAddress,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 401) {
        // Session expired
        currentUser = null;
        localStorage.removeItem('flapx_user');
        updateUI();
        showNotification('Session expired. Please login again.', 'error');
        return;
      }
      throw new Error(data.error || 'Claim failed');
    }
    
    showNotification(
      `Successfully claimed ${data.claimed.amount} BNB! TX: ${data.claimed.txHash.slice(0, 10)}...`,
      'success'
    );
    
    // Refresh earnings
    loadEarnings();
  } catch (error) {
    showNotification(error.message || 'Claim failed', 'error');
  } finally {
    hideLoading(claimBtn);
  }
}

// ============================================
// UI Update Functions
// ============================================

function updateUI() {
  const connectBtns = document.querySelectorAll('.btn-connect, #connectBtn');
  const notConnectedState = document.getElementById('notConnected');
  const connectedState = document.getElementById('connected');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const walletDisplay = document.getElementById('walletDisplay');
  const walletForm = document.getElementById('walletForm');
  const walletAddressText = document.getElementById('walletAddressText');
  
  if (currentUser) {
    // Update connect buttons
    connectBtns.forEach(btn => {
      const avatarUrl = currentUser.avatar || 'logo.png';
      btn.innerHTML = `
        <img src="${avatarUrl}" alt="Avatar" style="width: 20px; height: 20px; border-radius: 50%;" onerror="this.src='logo.png'">
        @${currentUser.userName}
      `;
      btn.onclick = handleLogout;
    });
    
    // Show connected state
    if (notConnectedState) notConnectedState.classList.add('hidden');
    if (connectedState) connectedState.classList.remove('hidden');
    
    // Update user info
    if (userAvatar) userAvatar.src = currentUser.avatar;
    if (userName) userName.textContent = `@${currentUser.userName}`;
    
    // Update wallet display
    if (currentUser.walletAddress) {
      if (walletDisplay) {
        walletDisplay.classList.remove('hidden');
      }
      if (walletAddressText) {
        walletAddressText.textContent = `${currentUser.walletAddress.slice(0, 6)}...${currentUser.walletAddress.slice(-4)}`;
      }
      if (walletForm) walletForm.classList.add('hidden');
    } else {
      if (walletDisplay) walletDisplay.classList.add('hidden');
      if (walletForm) walletForm.classList.remove('hidden');
    }
  } else {
    // Reset connect buttons
    connectBtns.forEach(btn => {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
        Connect
      `;
      btn.onclick = connectTwitter;
    });
    
    // Show not connected state
    if (notConnectedState) notConnectedState.classList.remove('hidden');
    if (connectedState) connectedState.classList.add('hidden');
  }
}

// ============================================
// Copy Command Function
// ============================================

function copyCommand(button) {
  const codeBlock = button.closest('.code-block');
  const code = codeBlock.querySelector('code');
  
  navigator.clipboard.writeText(code.textContent).then(() => {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
  });
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Handle OAuth callback first (just check for success/error flags)
  const callback = handleOAuthCallback();
  
  // Always verify session via secure cookie
  const isLoggedIn = await checkSession();
  
  // Show welcome message if just logged in
  if (callback.success && isLoggedIn && currentUser) {
    showNotification(`Welcome, @${currentUser.userName}!`, 'success');
  }
  
  // Update UI
  updateUI();
  
  // If logged in, load earnings and tokens
  if (currentUser) {
    loadEarnings();
    loadTokens();
  }
  
  // Set up event listeners
  const walletForm = document.getElementById('walletForm');
  if (walletForm) {
    walletForm.addEventListener('submit', handleSetWallet);
  }
  
  const claimBtn = document.getElementById('claimBtn');
  if (claimBtn) {
    claimBtn.addEventListener('click', handleClaim);
  }
  
  // Connect button click
  document.querySelectorAll('.btn-connect, #connectBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentUser) {
        handleLogout();
      } else {
        connectTwitter();
      }
    });
  });
  
  // Disconnect button
  const disconnectBtn = document.querySelector('.btn-disconnect');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', handleLogout);
  }
  
  // Connect X button in claim section
  const connectXBtn = document.querySelector('#notConnected .btn-primary');
  if (connectXBtn) {
    connectXBtn.addEventListener('click', connectTwitter);
  }
});

// ============================================
// Token Data Functions
// ============================================

const EXAMPLE_TOKEN_ADDRESS = '0x03d14efb32435cd6b304c062dac3606c06f87777';

/**
 * Fetch token market data from DexScreener API
 */
async function fetchTokenMarketData() {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${EXAMPLE_TOKEN_ADDRESS}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      return {
        marketCap: pair.marketCap || pair.fdv,
        volume24h: pair.volume?.h24,
        priceUsd: pair.priceUsd,
      };
    }
  } catch (error) {
    console.error('Failed to fetch token data:', error);
  }
  return null;
}

/**
 * Format number with K/M suffix
 */
function formatMarketNumber(num) {
  if (!num) return 'N/A';
  if (num >= 1000000) return '$' + (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return '$' + (num / 1000).toFixed(2) + 'K';
  return '$' + num.toFixed(2);
}

/**
 * Update token stats in hero section
 */
async function updateTokenStats() {
  const marketCapEl = document.getElementById('tokenMarketCap');
  const volumeEl = document.getElementById('tokenVolume');
  
  if (!marketCapEl || !volumeEl) return;
  
  const data = await fetchTokenMarketData();
  
  if (data) {
    marketCapEl.textContent = formatMarketNumber(data.marketCap);
    volumeEl.textContent = formatMarketNumber(data.volume24h);
  } else {
    marketCapEl.textContent = 'N/A';
    volumeEl.textContent = 'N/A';
  }
}

// Load token stats on page load
updateTokenStats();

// Refresh token stats every 30 seconds
setInterval(updateTokenStats, 30000);

// Make functions available globally
window.copyCommand = copyCommand;
window.connectTwitter = connectTwitter;
window.disconnectTwitter = handleLogout;
window.copyTokenAddress = copyTokenAddress;