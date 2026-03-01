#!/usr/bin/env npx tsx
/**
 * Private Key Encryption Tool
 * 
 * Usage:
 *   npx tsx src/encrypt-key.ts
 *   npm run encrypt-key
 * 
 * This tool will:
 * 1. Prompt for private key
 * 2. Prompt for password (twice for confirmation)
 * 3. Encrypt the private key using PBKDF2-SHA256 + AES-256-GCM
 * 4. Save to keystore.json
 */

import * as readline from 'readline';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  saveKeystore,
  DEFAULT_KEYSTORE_PATH,
} from './keystore.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    
    if (!process.stdin.isTTY) {
      rl.question('', (answer) => {
        resolve(answer);
      });
      return;
    }
    
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    
    let password = '';
    
    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        console.log('\nCancelled.');
        process.exit(0);
      } else if (char === '\u007F' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    };
    
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         🔐 FlapX Private Key Encryption Tool             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  console.log('This tool encrypts your private key using:');
  console.log('  • PBKDF2-SHA256 (100,000 iterations)');
  console.log('  • AES-256-GCM encryption');
  console.log('');
  console.log('⚠️  IMPORTANT:');
  console.log('  • Remember your password - it cannot be recovered');
  console.log('  • The keystore.json file is useless without the password');
  console.log('');
  
  // Get private key
  const privateKey = await questionHidden('Enter private key (with or without 0x): ');
  
  if (!privateKey) {
    console.log('\n❌ No private key provided.');
    process.exit(1);
  }
  
  // Validate private key format
  const normalizedKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  if (!/^[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    console.log('\n❌ Invalid private key format. Expected 64 hex characters.');
    process.exit(1);
  }
  
  console.log('✅ Private key format valid\n');
  
  // Get password
  const password1 = await questionHidden('Enter encryption password: ');
  
  if (!password1 || password1.length < 8) {
    console.log('\n❌ Password must be at least 8 characters.');
    process.exit(1);
  }
  
  const password2 = await questionHidden('Confirm encryption password: ');
  
  if (password1 !== password2) {
    console.log('\n❌ Passwords do not match.');
    process.exit(1);
  }
  
  console.log('\n⏳ Encrypting private key (this may take a moment)...\n');
  
  try {
    // Encrypt
    const keystore = encryptPrivateKey(privateKey, password1);
    
    // Verify decryption works
    const decrypted = decryptPrivateKey(keystore, password1);
    const expectedKey = privateKey.startsWith('0x') ? privateKey.toLowerCase() : '0x' + privateKey.toLowerCase();
    
    if (decrypted.toLowerCase() !== expectedKey) {
      throw new Error('Verification failed: decrypted key does not match original');
    }
    
    // Save to file
    saveKeystore(keystore, DEFAULT_KEYSTORE_PATH);
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SUCCESS! Private key encrypted and saved.');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log(`📁 Keystore file: ${DEFAULT_KEYSTORE_PATH}`);
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Delete your .env file (or remove PRIVATE_KEY from it)');
    console.log('   2. Start the bot: npm start');
    console.log('   3. Enter your password when prompted');
    console.log('');
    console.log('⚠️  For VPS deployment:');
    console.log('   • Copy keystore.json to VPS');
    console.log('   • Set KEY_PASSWORD environment variable, or');
    console.log('   • Enter password manually on startup');
    console.log('');
    
  } catch (error: any) {
    console.log(`\n❌ Encryption failed: ${error.message}`);
    process.exit(1);
  }
  
  rl.close();
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
