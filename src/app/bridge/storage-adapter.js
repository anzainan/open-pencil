import { bridgeClient } from './client';
function displayName(file) {
    return file.name.replace(/\.(fig|pen)$/i, '');
}
/**
 * bridge-fs storage provider adapter：document ID = 相对路径（品牌/文件名）。
 * 复用上游 StorageAdapter 接口与 storage binding 管线，写操作带 token。
 */
export function createBridgeStorageAdapter(_runtime, client = bridgeClient) {
    return {
        async testConnection() {
            try {
                await client.listFiles();
                return { ok: true, message: 'Connected to file-bridge.' };
            }
            catch (error) {
                return {
                    ok: false,
                    message: error instanceof Error ? error.message : String(error)
                };
            }
        },
        async listDocuments() {
            const listing = await client.listFiles();
            return listing.flat
                .map((file) => ({
                id: file.path,
                name: displayName(file),
                updatedAt: file.updatedAt,
                metadataAuthoritative: true
            }))
                .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
        },
        async getDocument(id, onProgress) {
            const bytes = await client.getFile(id);
            onProgress?.({ transferredBytes: bytes.byteLength, totalBytes: bytes.byteLength });
            return bytes;
        },
        async putDocument(id, bytes, _metadata, onProgress) {
            await client.putFile(id, bytes);
            onProgress?.({ transferredBytes: bytes.byteLength, totalBytes: bytes.byteLength });
        },
        async getDocumentMetadata(id) {
            const meta = await client.getFileMeta(id);
            if (!meta)
                return null;
            return { name: displayName(meta), updatedAt: meta.updatedAt };
        },
        async deleteDocument(id) {
            await client.deleteFile(id);
        },
        async getUsage() {
            const listing = await client.listFiles();
            const bytesUsed = listing.flat.reduce((total, file) => total + file.size, 0);
            return {
                bytesUsed,
                objectCount: listing.flat.length,
                documentCount: listing.flat.length
            };
        }
    };
}
