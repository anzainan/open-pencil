import { createBridgeStorageAdapter } from '@/app/bridge/storage-adapter'

import { defineStorageProvider, StorageProviderRegistry } from './registry'
import { createS3StorageAdapter } from './s3/adapter'

export const BRIDGE_STORAGE_PROVIDER = defineStorageProvider({
  id: 'bridge-fs',
  label: 'Bridge filesystem',
  description: 'Design files served by the local file-bridge (工作/设计/)',
  preferenceFields: [],
  credentialFields: [],
  createAdapter: createBridgeStorageAdapter
})

export const S3_STORAGE_PROVIDER = defineStorageProvider({
  id: 's3-compatible',
  label: 'S3 compatible',
  description: 'AWS S3, Backblaze B2, Cloudflare R2, MinIO, and compatible storage',
  preferenceFields: [
    { id: 'endpoint', label: 'Endpoint', kind: 'url', required: true },
    { id: 'bucket', label: 'Bucket', kind: 'text', required: true },
    { id: 'region', label: 'Region', kind: 'text' }
  ],
  credentialFields: [
    { id: 'access-key-id', label: 'Access key ID', required: true },
    { id: 'secret-access-key', label: 'Secret access key', required: true }
  ],
  createAdapter: createS3StorageAdapter
})

export const storageProviderRegistry = new StorageProviderRegistry([
  S3_STORAGE_PROVIDER,
  BRIDGE_STORAGE_PROVIDER
])
