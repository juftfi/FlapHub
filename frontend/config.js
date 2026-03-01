/**
 * FlapX Frontend Configuration
 * 
 * This config is automatically detected based on the current environment:
 * - Production (your domain): Uses Vercel API, local API disabled
 * - Local development (localhost): Uses local API for tokens
 * 
 * To override, edit the values below or create a config.local.js file
 */

(function() {
  // Detect environment
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  // ⚠️ Update this check for your production domain
  const isProduction = !isLocal && hostname !== ''; // Treat any non-local as production
  
  // Default configuration
  // ⚠️ Update these values for your deployment!
  const CONFIG = {
    // Production API (Vercel - for OAuth)
    // Replace with your Vercel domain
    API_BASE: isProduction ? `https://${hostname}/api` : 'http://localhost:3001/api',
    
    // Local API URL - only used in local development
    LOCAL_API_BASE: isLocal ? 'http://localhost:3001/api' : null,
    
    // Twitter Bot Username (the account that monitors mentions)
    // Replace with your bot's username
    BOT_USERNAME: 'YourBotUsername',
    
    // Social Links (replace with your own)
    TWITTER_URL: 'https://x.com/YourProjectAccount',
    PROTOCOL_URL: 'https://flap.sh',
    
    // Chain Info
    CHAIN_NAME: 'BNB Chain',
    EXPLORER_URL: 'https://bscscan.com',
    
    // Token Settings
    TAX_RATE: '3%',
    USER_SHARE: '2/3',
    
    // Environment info (for debugging)
    ENV: isProduction ? 'production' : (isLocal ? 'development' : 'unknown'),
  };
  
  // Log config in development
  if (isLocal) {
    console.log('[FlapX Config]', {
      env: CONFIG.ENV,
      apiBase: CONFIG.API_BASE,
      localApiBase: CONFIG.LOCAL_API_BASE,
    });
  }
  
  // Expose config globally
  window.FLAPX_CONFIG = CONFIG;
})();
