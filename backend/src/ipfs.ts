import fs from 'fs';
import path from 'path';

// Flap GraphQL API for uploading
const FLAP_UPLOAD_API = 'https://funcs.flap.sh/api/upload';

/**
 * Upload image and metadata to IPFS using Flap's GraphQL API
 * This is the official way as described in Flap documentation
 * 
 * The API accepts a GraphQL mutation with:
 * - file: The image file
 * - meta: Metadata object (description, website, twitter, telegram, creator)
 * 
 * Returns the IPFS CID of the metadata JSON (which contains the image CID)
 */
export async function uploadToFlapGraphQL(
  imagePath: string,
  metadata: {
    description: string;
    creator: string;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    buy?: string | null;
    sell?: string | null;
  }
): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const mimeType = getContentType(fileName);
  
  // GraphQL mutation as per Flap docs
  const MUTATION_CREATE = `
    mutation Create($file: Upload!, $meta: MetadataInput!) {
      create(file: $file, meta: $meta)
    }
  `;
  
  // Build multipart form data manually for GraphQL file upload
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  
  const formDataParts: Buffer[] = [];
  
  // Part 1: operations (GraphQL query and variables)
  const operations = JSON.stringify({
    query: MUTATION_CREATE,
    variables: {
      file: null,  // Will be replaced by the map
      meta: {
        website: metadata.website || null,
        twitter: metadata.twitter || null,
        telegram: metadata.telegram || null,
        description: metadata.description,
        creator: metadata.creator,
        buy: metadata.buy || null,
        sell: metadata.sell || null,
      }
    }
  });
  
  formDataParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="operations"\r\n\r\n` +
    operations + '\r\n'
  ));
  
  // Part 2: map (tells GraphQL where to put the file)
  const map = JSON.stringify({
    "0": ["variables.file"]
  });
  
  formDataParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="map"\r\n\r\n` +
    map + '\r\n'
  ));
  
  // Part 3: the actual file
  formDataParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="0"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  ));
  formDataParts.push(imageBuffer);
  formDataParts.push(Buffer.from('\r\n'));
  
  // End boundary
  formDataParts.push(Buffer.from(`--${boundary}--\r\n`));
  
  const body = Buffer.concat(formDataParts);
  
  console.log('Uploading to Flap IPFS via GraphQL...');
  console.log(`  Image: ${imagePath} (${imageBuffer.length} bytes)`);
  console.log(`  Description: ${metadata.description.substring(0, 50)}...`);
  
  const response = await fetch(FLAP_UPLOAD_API, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload to Flap IPFS: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json() as { data?: { create?: string }; errors?: any[] };
  
  if (data.errors && data.errors.length > 0) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  
  const cid = data.data?.create;
  
  if (!cid) {
    throw new Error(`No CID in response: ${JSON.stringify(data)}`);
  }
  
  console.log(`  ✅ Uploaded! CID: ${cid}`);
  console.log(`  Meta URL: https://flap.mypinata.cloud/ipfs/${cid}`);
  
  return cid;
}

/**
 * Get content type based on file extension
 */
function getContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Upload image from URL to IPFS using Flap's GraphQL API
 * Downloads the image first, then uploads to IPFS
 */
export async function uploadImageUrlToIPFS(
  imageUrl: string,
  metadata: {
    description: string;
    creator: string;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
  }
): Promise<string> {
  console.log(`[IPFS] Downloading image from URL: ${imageUrl}`);
  
  // Download the image
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  
  const contentType = response.headers.get('content-type') || 'image/png';
  const arrayBuffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);
  
  console.log(`[IPFS] Downloaded ${imageBuffer.length} bytes, type: ${contentType}`);
  
  // Determine file extension from content type
  let fileName = 'image.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    fileName = 'image.jpg';
  } else if (contentType.includes('gif')) {
    fileName = 'image.gif';
  } else if (contentType.includes('webp')) {
    fileName = 'image.webp';
  }
  
  // GraphQL mutation
  const MUTATION_CREATE = `
    mutation Create($file: Upload!, $meta: MetadataInput!) {
      create(file: $file, meta: $meta)
    }
  `;
  
  // Build multipart form data
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  
  const formDataParts: Buffer[] = [];
  
  // Part 1: operations
  const operations = JSON.stringify({
    query: MUTATION_CREATE,
    variables: {
      file: null,
      meta: {
        website: metadata.website || null,
        twitter: metadata.twitter || null,
        telegram: metadata.telegram || null,
        description: metadata.description,
        creator: metadata.creator,
      }
    }
  });
  
  formDataParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="operations"\r\n\r\n` +
    operations + '\r\n'
  ));
  
  // Part 2: map
  const map = JSON.stringify({
    "0": ["variables.file"]
  });
  
  formDataParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="map"\r\n\r\n` +
    map + '\r\n'
  ));
  
  // Part 3: the actual file
  formDataParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="0"; filename="${fileName}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  ));
  formDataParts.push(imageBuffer);
  formDataParts.push(Buffer.from('\r\n'));
  
  // End boundary
  formDataParts.push(Buffer.from(`--${boundary}--\r\n`));
  
  const body = Buffer.concat(formDataParts);
  
  console.log('[IPFS] Uploading to Flap IPFS...');
  
  const uploadResponse = await fetch('https://funcs.flap.sh/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Failed to upload to IPFS: ${uploadResponse.status} - ${errorText}`);
  }
  
  const data = await uploadResponse.json() as { data?: { create?: string }; errors?: any[] };
  
  if (data.errors && data.errors.length > 0) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }
  
  const cid = data.data?.create;
  
  if (!cid) {
    throw new Error(`No CID in response: ${JSON.stringify(data)}`);
  }
  
  console.log(`[IPFS] ✅ Uploaded! CID: ${cid}`);
  return cid;
}
