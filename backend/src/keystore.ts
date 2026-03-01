/**
 * Keystore Module - Secure Private Key Storage
 * 
 * Security Architecture:
 * 1. Password → PBKDF2-SHA256 (100,000 iterations) → Derived Key
 * 2. Derived Key + IV → AES-256-GCM → Encrypted Private Key
 * 3. Output: JSON file with { encrypted, iv, salt, algorithm metadata }
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Encryption parameters
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Keystore file structure
 */
export interface KeystoreFile {
  version: number;
  crypto: {
    cipher: string;
    ciphertext: string; // hex encoded
    cipherparams: {
      iv: string; // hex encoded
    };
    kdf: string;
    kdfparams: {
      dklen: number;
      salt: string; // hex encoded
      c: number; // iterations
      prf: string;
    };
    mac: string; // auth tag, hex encoded
  };
  meta: {
    createdAt: string;
    description: string;
  };
}

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

/**
 * Encrypt a private key with password
 * @param privateKey - The private key to encrypt (with or without 0x prefix)
 * @param password - The encryption password
 * @returns KeystoreFile object
 */
export function encryptPrivateKey(privateKey: string, password: string): KeystoreFile {
  // Normalize private key (remove 0x prefix if present)
  const normalizedKey = privateKey.startsWith('0x') 
    ? privateKey.slice(2) 
    : privateKey;
  
  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(normalizedKey)) {
    throw new Error('Invalid private key format. Expected 64 hex characters.');
  }
  
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive encryption key from password
  const derivedKey = deriveKey(password, salt);
  
  // Encrypt private key using AES-256-GCM
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
  
  const privateKeyBuffer = Buffer.from(normalizedKey, 'hex');
  let encrypted = cipher.update(privateKeyBuffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  // Get authentication tag
  const authTag = cipher.getAuthTag();
  
  // Create keystore object
  const keystore: KeystoreFile = {
    version: 1,
    crypto: {
      cipher: ALGORITHM,
      ciphertext: encrypted.toString('hex'),
      cipherparams: {
        iv: iv.toString('hex'),
      },
      kdf: 'pbkdf2',
      kdfparams: {
        dklen: KEY_LENGTH,
        salt: salt.toString('hex'),
        c: PBKDF2_ITERATIONS,
        prf: `hmac-${PBKDF2_DIGEST}`,
      },
      mac: authTag.toString('hex'),
    },
    meta: {
      createdAt: new Date().toISOString(),
      description: 'FlapX Bot Encrypted Private Key',
    },
  };
  
  return keystore;
}

/**
 * Decrypt a private key from keystore
 * @param keystore - The keystore object
 * @param password - The decryption password
 * @returns The decrypted private key with 0x prefix
 */
export function decryptPrivateKey(keystore: KeystoreFile, password: string): string {
  // Extract parameters
  const salt = Buffer.from(keystore.crypto.kdfparams.salt, 'hex');
  const iv = Buffer.from(keystore.crypto.cipherparams.iv, 'hex');
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, 'hex');
  const authTag = Buffer.from(keystore.crypto.mac, 'hex');
  
  // Derive key from password
  const derivedKey = deriveKey(password, salt);
  
  // Decrypt using AES-256-GCM
  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);
  
  try {
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return '0x' + decrypted.toString('hex');
  } catch (error) {
    throw new Error('Decryption failed. Wrong password or corrupted keystore.');
  }
}

/**
 * Save keystore to file
 */
export function saveKeystore(keystore: KeystoreFile, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(keystore, null, 2), 'utf-8');
  
  // Set restrictive permissions (owner read/write only)
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (e) {
    // Windows doesn't support chmod, ignore
  }
}

/**
 * Load keystore from file
 */
export function loadKeystore(filePath: string): KeystoreFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keystore file not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const keystore = JSON.parse(content) as KeystoreFile;
  
  // Validate keystore structure
  if (!keystore.version || !keystore.crypto || !keystore.crypto.ciphertext) {
    throw new Error('Invalid keystore file format');
  }
  
  return keystore;
}

/**
 * Check if keystore file exists
 */
export function keystoreExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Prompt for password from terminal (hidden input)
 */
export function promptPassword(prompt: string = 'Enter password: '): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    // Hide input on Unix-like systems
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          // Enter or Ctrl+D
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(password);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
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
    } else {
      // Non-TTY (piped input)
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Default keystore path
 */
export const DEFAULT_KEYSTORE_PATH = path.join(process.cwd(), 'keystore.json');
