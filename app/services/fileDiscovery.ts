/**
 * File Discovery Service
 * Office Lens-style: Auto-discover existing files in export directories on fresh install
 */
import { ApplicationSettings, File, Folder, knownFolders, path } from '@nativescript/core';
import { documentsService } from './documents';
import { IMAGE_EXPORT_DIRECTORY, PDF_EXPORT_DIRECTORY, SETTINGS_FIRST_OPEN } from '~/utils/constants';

const SETTINGS_FILE_DISCOVERY_DONE = 'file_discovery_done';

/**
 * Ensures export directories exist
 */
export async function ensureExportDirectories(): Promise<void> {
    if (!__ANDROID__) return;

    try {
        // Create PDF export directory
        if (PDF_EXPORT_DIRECTORY) {
            const pdfFolder = Folder.fromPath(PDF_EXPORT_DIRECTORY);
            if (!File.exists(PDF_EXPORT_DIRECTORY)) {
                await pdfFolder.create();
                DEV_LOG && console.log('Created PDF export directory:', PDF_EXPORT_DIRECTORY);
            }
        }

        // Create Image export directory
        if (IMAGE_EXPORT_DIRECTORY) {
            const imageFolder = Folder.fromPath(IMAGE_EXPORT_DIRECTORY);
            if (!File.exists(IMAGE_EXPORT_DIRECTORY)) {
                await imageFolder.create();
                DEV_LOG && console.log('Created Image export directory:', IMAGE_EXPORT_DIRECTORY);
            }
        }
    } catch (error) {
        DEV_LOG && console.log('Error creating export directories:', error);
    }
}

/**
 * Discover existing files in export directories and import them into the app
 * This is called on fresh install to populate the document list
 */
export async function discoverExistingFiles(): Promise<void> {
    if (!__ANDROID__) return;

    // Check if we've already done discovery
    const discoveryDone = ApplicationSettings.getBoolean(SETTINGS_FILE_DISCOVERY_DONE, false);
    if (discoveryDone) {
        DEV_LOG && console.log('File discovery already done, skipping');
        return;
    }

    DEV_LOG && console.log('Starting file discovery...');

    try {
        await ensureExportDirectories();

        const discoveredFiles: { path: string; type: 'pdf' | 'image' }[] = [];

        // Scan PDF directory
        if (PDF_EXPORT_DIRECTORY && File.exists(PDF_EXPORT_DIRECTORY)) {
            const pdfFolder = Folder.fromPath(PDF_EXPORT_DIRECTORY);
            const pdfFiles = pdfFolder.getEntitiesSync();
            for (const entity of pdfFiles) {
                if (entity.isFile && entity.name.toLowerCase().endsWith('.pdf')) {
                    discoveredFiles.push({ path: entity.path, type: 'pdf' });
                    DEV_LOG && console.log('Found PDF:', entity.path);
                }
            }
        }

        // Scan Image directory
        if (IMAGE_EXPORT_DIRECTORY && File.exists(IMAGE_EXPORT_DIRECTORY)) {
            const imageFolder = Folder.fromPath(IMAGE_EXPORT_DIRECTORY);
            const imageFiles = imageFolder.getEntitiesSync();
            for (const entity of imageFiles) {
                if (entity.isFile) {
                    const ext = entity.name.toLowerCase();
                    if (ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png')) {
                        discoveredFiles.push({ path: entity.path, type: 'image' });
                        DEV_LOG && console.log('Found Image:', entity.path);
                    }
                }
            }
        }

        DEV_LOG && console.log(`Discovered ${discoveredFiles.length} files`);

        // Mark discovery as done
        ApplicationSettings.setBoolean(SETTINGS_FILE_DISCOVERY_DONE, true);

        // Note: Full import would require creating document records in the database
        // This is a placeholder - actual implementation would depend on the
        // documentsService API for importing external files
        if (discoveredFiles.length > 0) {
            DEV_LOG && console.log('Files discovered and ready for import:', discoveredFiles.map(f => f.path));
            // TODO: Implement actual import logic using documentsService
            // This would create Document and Page records for each discovered file
        }
    } catch (error) {
        DEV_LOG && console.log('Error during file discovery:', error);
    }
}

/**
 * Start the file discovery service
 */
export async function startFileDiscovery(): Promise<void> {
    if (!__ANDROID__) return;
    await discoverExistingFiles();
}

/**
 * Reset file discovery (for testing)
 */
export function resetFileDiscovery(): void {
    ApplicationSettings.setBoolean(SETTINGS_FILE_DISCOVERY_DONE, false);
}
