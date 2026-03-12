/**
 * File Discovery Service
 * Office Lens-style: Auto-discover existing files in export directories on every app launch
 * and import them into the app's document database
 */
import { ApplicationSettings, File, Folder, ImageSource, knownFolders, path } from '@nativescript/core';
import { OCRDocument, PageData, getDocumentsService } from '~/models/OCRDocument';
import { IMAGE_EXPORT_DIRECTORY, PDF_EXPORT_DIRECTORY, IMG_FORMAT, getImageExportSettings } from '~/utils/constants';
import { getImageSize } from 'plugin-nativeprocessor';

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
                console.log('Created PDF export directory:', PDF_EXPORT_DIRECTORY);
            }
        }

        // Create Image export directory
        if (IMAGE_EXPORT_DIRECTORY) {
            if (!File.exists(IMAGE_EXPORT_DIRECTORY)) {
                const imageFolder = Folder.fromPath(IMAGE_EXPORT_DIRECTORY);
                await imageFolder.create();
                console.log('Created Image export directory:', IMAGE_EXPORT_DIRECTORY);
            }
        }
    } catch (error) {
        console.log('Error creating export directories:', error);
    }
}

/**
 * Check if a file has already been imported (by checking if document exists with same source path)
 */
async function isFileAlreadyImported(filePath: string): Promise<boolean> {
    try {
        const documentsService = getDocumentsService();
        if (!documentsService) return false;
        
        // Check all documents to see if any have this file as source
        const docs = await documentsService.documentRepository.search();
        for (const doc of docs) {
            if (doc.extra?.importedPdfPath === filePath) {
                return true;
            }
            // Check pages for image imports
            if (doc.pages) {
                for (const page of doc.pages) {
                    if (page.sourceImagePath === filePath || page.imagePath === filePath) {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch (e) {
        console.log('Error checking if file imported:', e);
        return false;
    }
}

/**
 * Import an image file as a new document
 */
async function importImageAsDocument(imagePath: string): Promise<OCRDocument | null> {
    try {
        console.log('Importing image as document:', imagePath);
        
        // Check if already imported
        if (await isFileAlreadyImported(imagePath)) {
            console.log('Image already imported, skipping:', imagePath);
            return null;
        }
        
        const fileName = imagePath.split('/').pop() || 'Imported Image';
        const imageSize = await getImageSize(imagePath);
        
        console.log('Image size:', imageSize.width, 'x', imageSize.height, 'rotation:', imageSize.rotation);
        
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
        
        console.log('Created document from image:', doc.id, doc.name);
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
        console.log('Importing PDF as document:', pdfPath);
        
        // Check if already imported
        if (await isFileAlreadyImported(pdfPath)) {
            console.log('PDF already imported, skipping:', pdfPath);
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
        
        console.log('Created document from PDF:', doc.id, doc.name);
        return doc;
    } catch (error) {
        console.error('Error importing PDF:', pdfPath, error);
        return null;
    }
}

/**
 * Discover existing files in export directories and import them into the app
 * This is called on every app launch to populate the document list
 */
export async function discoverExistingFiles(): Promise<number> {
    if (!__ANDROID__) {
        console.log('File discovery: Not Android, skipping');
        return 0;
    }

    console.log('Starting file discovery...');
    console.log('PDF_EXPORT_DIRECTORY:', PDF_EXPORT_DIRECTORY);
    console.log('IMAGE_EXPORT_DIRECTORY:', IMAGE_EXPORT_DIRECTORY);
    
    let importedCount = 0;

    try {
        await ensureExportDirectories();

        // Import images from Pictures/DocumentScanner
        if (IMAGE_EXPORT_DIRECTORY) {
            console.log('Checking image directory:', IMAGE_EXPORT_DIRECTORY);
            if (File.exists(IMAGE_EXPORT_DIRECTORY)) {
                console.log('Image directory exists');
                try {
                    const imageFolder = Folder.fromPath(IMAGE_EXPORT_DIRECTORY);
                    const entities = imageFolder.getEntitiesSync();
                    console.log('Found', entities.length, 'items in image directory');
                    
                    for (const entity of entities) {
                        if (entity.isFile) {
                            const ext = entity.name.toLowerCase();
                            if (ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp')) {
                                console.log('Found image to import:', entity.path);
                                const doc = await importImageAsDocument(entity.path);
                                if (doc) {
                                    importedCount++;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error scanning image directory:', e);
                }
            } else {
                console.log('Image directory does not exist');
            }
        }

        // Import PDFs from Documents/DocumentScanner
        if (PDF_EXPORT_DIRECTORY) {
            console.log('Checking PDF directory:', PDF_EXPORT_DIRECTORY);
            if (File.exists(PDF_EXPORT_DIRECTORY)) {
                console.log('PDF directory exists');
                try {
                    const pdfFolder = Folder.fromPath(PDF_EXPORT_DIRECTORY);
                    const entities = pdfFolder.getEntitiesSync();
                    console.log('Found', entities.length, 'items in PDF directory');
                    
                    for (const entity of entities) {
                        if (entity.isFile && entity.name.toLowerCase().endsWith('.pdf')) {
                            console.log('Found PDF to import:', entity.path);
                            const doc = await importPdfAsDocument(entity.path);
                            if (doc) {
                                importedCount++;
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error scanning PDF directory:', e);
                }
            } else {
                console.log('PDF directory does not exist');
            }
        }

        console.log('File discovery complete. Imported', importedCount, 'files.');
        
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
