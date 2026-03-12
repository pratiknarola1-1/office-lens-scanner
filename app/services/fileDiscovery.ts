/**
 * File Discovery Service
 * Office Lens-style: Auto-discover existing files in export directories on fresh install
 * and import them into the app's document database
 */
import { ApplicationSettings, File, Folder, ImageSource, knownFolders, path } from '@nativescript/core';
import { OCRDocument, PageData, getDocumentsService } from '~/models/OCRDocument';
import { IMAGE_EXPORT_DIRECTORY, PDF_EXPORT_DIRECTORY, IMG_FORMAT, getImageExportSettings } from '~/utils/constants';
import { getImageSize } from 'plugin-nativeprocessor';

const SETTINGS_FILE_DISCOVERY_DONE = 'file_discovery_done';

/**
 * Ensures export directories exist
 */
export async function ensureExportDirectories(): Promise<void> {
    if (!__ANDROID__) return;

    try {
        // Create PDF export directory
        if (PDF_EXPORT_DIRECTORY) {
            if (!File.exists(PDF_EXPORT_DIRECTORY)) {
                const pdfFolder = Folder.fromPath(PDF_EXPORT_DIRECTORY);
                await pdfFolder.create();
                DEV_LOG && console.log('Created PDF export directory:', PDF_EXPORT_DIRECTORY);
            }
        }

        // Create Image export directory
        if (IMAGE_EXPORT_DIRECTORY) {
            if (!File.exists(IMAGE_EXPORT_DIRECTORY)) {
                const imageFolder = Folder.fromPath(IMAGE_EXPORT_DIRECTORY);
                await imageFolder.create();
                DEV_LOG && console.log('Created Image export directory:', IMAGE_EXPORT_DIRECTORY);
            }
        }
    } catch (error) {
        DEV_LOG && console.log('Error creating export directories:', error);
    }
}

/**
 * Import an image file as a new document
 */
async function importImageAsDocument(imagePath: string): Promise<OCRDocument | null> {
    try {
        DEV_LOG && console.log('Importing image as document:', imagePath);
        
        const documentsService = getDocumentsService();
        if (!documentsService) {
            DEV_LOG && console.log('DocumentsService not available');
            return null;
        }
        
        const fileName = imagePath.split('/').pop() || 'Imported Image';
        const imageSize = await getImageSize(imagePath);
        
        const pageData: PageData = {
            imagePath: imagePath,
            sourceImagePath: imagePath,
            width: imageSize.width,
            height: imageSize.height,
            rotation: imageSize.rotation || 0,
            sourceImageWidth: imageSize.width,
            sourceImageHeight: imageSize.height,
            sourceImageRotation: imageSize.rotation || 0,
            crop: [
                [0, 0],
                [imageSize.width, 0],
                [imageSize.width, imageSize.height],
                [0, imageSize.height]
            ]
        };
        
        const doc = await OCRDocument.createDocument([pageData], undefined, { 
            name: fileName.replace(/\.[^/.]+$/, '') 
        });
        
        DEV_LOG && console.log('Created document from image:', doc.id);
        return doc;
    } catch (error) {
        console.error('Error importing image:', imagePath, error);
        return null;
    }
}

/**
 * Import a PDF file as a new document
 * Note: PDFs are stored as single document references, not converted to images
 */
async function importPdfAsDocument(pdfPath: string): Promise<OCRDocument | null> {
    try {
        DEV_LOG && console.log('Importing PDF as document:', pdfPath);
        
        const documentsService = getDocumentsService();
        if (!documentsService) {
            DEV_LOG && console.log('DocumentsService not available');
            return null;
        }
        
        const fileName = pdfPath.split('/').pop() || 'Imported PDF';
        
        // Create a document that references the PDF
        // We store the PDF path in extra metadata
        const doc = await OCRDocument.createDocument([], undefined, {
            name: fileName.replace(/\.[^/.]+$/, ''),
            extra: {
                importedPdfPath: pdfPath,
                importedType: 'pdf'
            }
        });
        
        DEV_LOG && console.log('Created document from PDF:', doc.id);
        return doc;
    } catch (error) {
        console.error('Error importing PDF:', pdfPath, error);
        return null;
    }
}

/**
 * Discover existing files in export directories and import them into the app
 * This is called on fresh install to populate the document list
 */
export async function discoverExistingFiles(): Promise<number> {
    if (!__ANDROID__) return 0;

    // Check if we've already done discovery
    const discoveryDone = ApplicationSettings.getBoolean(SETTINGS_FILE_DISCOVERY_DONE, false);
    if (discoveryDone) {
        DEV_LOG && console.log('File discovery already done, skipping');
        return 0;
    }

    DEV_LOG && console.log('Starting file discovery...');
    let importedCount = 0;

    try {
        await ensureExportDirectories();

        // Import images from Pictures/DocumentScanner
        if (IMAGE_EXPORT_DIRECTORY && File.exists(IMAGE_EXPORT_DIRECTORY)) {
            try {
                const imageFolder = Folder.fromPath(IMAGE_EXPORT_DIRECTORY);
                const entities = imageFolder.getEntitiesSync();
                
                for (const entity of entities) {
                    if (entity.isFile) {
                        const ext = entity.name.toLowerCase();
                        if (ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp')) {
                            DEV_LOG && console.log('Found image to import:', entity.path);
                            const doc = await importImageAsDocument(entity.path);
                            if (doc) {
                                importedCount++;
                            }
                        }
                    }
                }
            } catch (e) {
                DEV_LOG && console.log('Error scanning image directory:', e);
            }
        }

        // Import PDFs from Documents/DocumentScanner
        if (PDF_EXPORT_DIRECTORY && File.exists(PDF_EXPORT_DIRECTORY)) {
            try {
                const pdfFolder = Folder.fromPath(PDF_EXPORT_DIRECTORY);
                const entities = pdfFolder.getEntitiesSync();
                
                for (const entity of entities) {
                    if (entity.isFile && entity.name.toLowerCase().endsWith('.pdf')) {
                        DEV_LOG && console.log('Found PDF to import:', entity.path);
                        const doc = await importPdfAsDocument(entity.path);
                        if (doc) {
                            importedCount++;
                        }
                    }
                }
            } catch (e) {
                DEV_LOG && console.log('Error scanning PDF directory:', e);
            }
        }

        DEV_LOG && console.log(`File discovery complete. Imported ${importedCount} files.`);
        
        // Mark discovery as done
        ApplicationSettings.setBoolean(SETTINGS_FILE_DISCOVERY_DONE, true);
        
    } catch (error) {
        console.error('Error during file discovery:', error);
    }

    return importedCount;
}

/**
 * Start the file discovery service
 */
export async function startFileDiscovery(): Promise<number> {
    if (!__ANDROID__) return 0;
    return await discoverExistingFiles();
}

/**
 * Reset file discovery (for testing)
 */
export function resetFileDiscovery(): void {
    ApplicationSettings.setBoolean(SETTINGS_FILE_DISCOVERY_DONE, false);
}
