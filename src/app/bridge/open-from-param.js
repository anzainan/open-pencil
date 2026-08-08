import { BRIDGE_PROVIDER_ID, bridgeClient } from '@/app/bridge/client';
import { activeStorageProviderID } from '@/app/integrations/storage';
import { openStorageDocumentInNewTab } from '@/app/tabs';
import { IS_BROWSER } from '@/constants';
export function openFileFromQueryParam() {
    if (!IS_BROWSER || typeof window === 'undefined')
        return;
    const params = new URLSearchParams(window.location.search);
    const relPath = params.get('file');
    if (!relPath || relPath.trim() === '')
        return;
    activeStorageProviderID.value = BRIDGE_PROVIDER_ID;
    const name = relPath.split(/[\\/]/).pop() ?? 'file.fig';
    void (async () => {
        const meta = await bridgeClient.getFileMeta(relPath).catch(() => null);
        const document = {
            id: relPath,
            name: name.replace(/\.(fig|pen)$/i, ''),
            updatedAt: meta?.updatedAt ?? new Date().toISOString(),
            metadataAuthoritative: true
        };
        await openStorageDocumentInNewTab(document);
    })().catch((error) => {
        console.warn('[open-from-param]', error);
    });
}
