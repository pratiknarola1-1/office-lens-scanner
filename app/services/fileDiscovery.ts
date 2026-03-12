/**
 * File Discovery Service
 * Office Lens-style: Auto-discover existing files in export directories on every app launch
 * and import them into the app's document database
 */
import { ApplicationSettings, File, Folder, ImageSource, knownFolders, path, Utils, Application } from '@nativescript/core';
import { OCRDocument, PageData, getDocumentsService } from '~/models/OCRDocument';
import { IMAGE_EXPORT_DIRECTORY, PDF_EXPORT_DIRECTORY, IMG_FORMAT, getImageExportSettings } from '~/utils/constants';
import { getImageSize } from 'plugin-nativeprocessor';

/**
 * Check if we have permission to read external storage
 */
function hasStoragePermission(): boolean {
    if (!__ANDROID__) return false;
    
    const context = Utils.android.getApplicationContext();
    
    // Android 11+ needs MANAGE_EXTERNAL_STORAGE for broad file access
    if (android.os.Build.VERSION.SDK_INT >= 30) {
        return android.os.Environment.isExternalStorageManager();
    }
    
    // Android 10 and below - check READ_EXTERNAL_STORAGE
    if (context.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) === android.content.pm.PackageManager.PERMISSION_GRANTED) {
        return true;
    }
    
    return false;
}

/**
 * Request storage permission
 */
async function requestStoragePermission(): Promise<boolean> {
    if (!__ANDROID__) return false;
    
    const context = Utils.android.getApplicationContext();
    const activity = Application.android.foregroundActivity || Application.android.startActivity;
    
    // Android 11+ needs MANAGE_EXTERNAL_STORAGE
    if (android.os.Build.VERSION.SDK_INT >= 30) {
        if (!android.os.Environment.isExternalStorageManager()) {
            try {
                const intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(android.net.Uri.parse('package:' + context.getPackageName()));
                activity.startActivity(intent);
                return false; // Need to wait for user to grant permission
            } catch (e) {
                // Fallback to generic settings
                const intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                activity.startActivity(intent);
                return false;
            }
        }
        return true;
    }
    
    // Android 10 and below
    return new Promise((resolve) => {
        const REQUEST_CODE = 1234;
        activity.requestPermissions(
            [android.Manifest.permission.READ_EXTERNAL_STORAGE],
            REQUEST_CODE
        );
        // Note: This is async, we'd need to handle the result
        // For now, return false and let next launch try again
        resolve(false);
    });
}

/**
 * Get the PDF export directory path
 */
export function getPdfExportDirectory(): string | null {
    if (!__ANDROID__) return null;
    try {
        const docDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOCUMENTS);
        if (docDir) {
            return docDir.getAbsolutePath() + '/DocumentScanner';
        }
    } catch (e) {
        console.log('Error getting PDF directory:', e);
    }
    return null;
}

/**
 * Get the Image export directory path
 */
export function getImageExportDirectory(): string | null {
    if (!__ANDROID__) return null;
    try {
        const picDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES);
        if (picDir) {
            return picDir.getAbsolutePath() + '/DocumentScanner';
        }
    } catch (e) {
        console.log('Error getting Image directory:', e);
    }
    return null;
}

/**
 * Check if a file has already been imported
 */
async function isFileAlreadyImported(filePath: string): Promise<boolean> {
    try {
        const documentsService = getDocumentsService();
        if (!documentsService) return false;
        
        const docs = await documentsService.documentRepository.search();
        for (const doc of docs) {
            if (doc.extra?.importedPdfPath === filePath) {
                return true;
            }
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
 */
async function importPdfAsDocument(pdfPath: string): Promise<OCRDocument | null> {
    try {
        console.log('Importing PDF as document:', pdfPath);
        
        if (await isFileAlreadyImported(pdfPath)) {
            console.log('PDF already imported, skipping:', pdfPath);
            return null;
        }
        
        const fileName = pdfPath.split('/').pop() || 'Imported PDF';
        
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
 * List files in a directory using Java File API
 */
function listFilesInDirectory(dirPath: string): string[] {
    const files: string[] = [];
    try {
        console.log('Listing files in:', dirPath);
        const javaFile = new java.io.File(dirPath);
        
        console.log('Directory exists:', javaFile.exists());
        console.log('Is directory:', javaFile.isDirectory());
        console.log('Can read:', javaFile.canRead());
        
        if (!javaFile.exists() || !javaFile.isDirectory()) {
            return files;
        }
        
        const children = javaFile.listFiles();
        console.log('listFiles result:', children ? 'not null' : 'null');
        
        if (children) {
            console.log('Number of children:', children.length);
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                console.log('Child:', child.getName(), 'isFile:', child.isFile(), 'isDir:', child.isDirectory());
                if (child.isFile()) {
                    files.push(child.getAbsolutePath());
                }
            }
        }
        console.log('Total files found:', files.length);
    } catch (e) {
        console.error('Error listing directory:', dirPath, e);
    }
    return files;
}

/**
 * Discover existing files in export directories and import them into the app
 */
export async function discoverExistingFiles(): Promise<number> {
    if (!__ANDROID__) {
        console.log('File discovery: Not Android, skipping');
        return 0;
    }

    console.log('=== Starting file discovery ===');
    
    // Check storage permission first
    const hasPermission = hasStoragePermission();
    console.log('Has storage permission:', hasPermission);
    
    if (!hasPermission) {
        console.log('Requesting storage permission...');
        const granted = await requestStoragePermission();
        console.log('Permission granted:', granted);
        if (!granted) {
            console.log('Storage permission not granted, cannot discover files');
            console.log('Please grant "Allow all the time" or "Allow access to manage all files" permission');
            return 0;
        }
    }

    let importedCount = 0;

    try {
        // Get directory paths
        const pdfDir = getPdfExportDirectory();
        const imageDir = getImageExportDirectory();
        
        console.log('PDF directory:', pdfDir);
        console.log('Image directory:', imageDir);

        // Process PDFs
        if (pdfDir) {
            console.log('--- Scanning PDF directory ---');
            const pdfFiles = listFilesInDirectory(pdfDir);
            
            for (const pdfPath of pdfFiles) {
                if (pdfPath.toLowerCase().endsWith('.pdf')) {
                    console.log('Processing PDF:', pdfPath);
                    const doc = await importPdfAsDocument(pdfPath);
                    if (doc) {
                        importedCount++;
                    }
                }
            }
        }

        // Process Images
        if (imageDir) {
            console.log('--- Scanning Image directory ---');
            const imageFiles = listFilesInDirectory(imageDir);
            
            for (const imagePath of imageFiles) {
                const ext = imagePath.toLowerCase();
                if (ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp')) {
                    console.log('Processing Image:', imagePath);
                    const doc = await importImageAsDocument(imagePath);
                    if (doc) {
                        importedCount++;
                    }
                }
            }
        }

        console.log('=== File discovery complete. Imported:', importedCount, 'files ===');
        
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
