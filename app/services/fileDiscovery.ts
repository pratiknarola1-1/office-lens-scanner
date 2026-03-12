/**
 * File Discovery Service
 * Office Lens-style: Auto-discover existing files in export directories on every app launch
 * and import them into the app's document database
 */
import { ApplicationSettings, File, Folder, ImageSource, knownFolders, path, Utils, Application } from '@nativescript/core';
import { OCRDocument, PageData, getDocumentsService } from '~/models/OCRDocument';
import { IMAGE_EXPORT_DIRECTORY, PDF_EXPORT_DIRECTORY, IMG_FORMAT, getImageExportSettings, PDFImportImages } from '~/utils/constants';
import { getImageSize } from 'plugin-nativeprocessor';

/**
 * Check if we have permission to read external storage
 */
function hasStoragePermission(): boolean {
    if (!__ANDROID__) return false;
    
    const context = Utils.android.getApplicationContext();
    
    if (android.os.Build.VERSION.SDK_INT >= 30) {
        return android.os.Environment.isExternalStorageManager();
    }
    
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
    
    if (android.os.Build.VERSION.SDK_INT >= 30) {
        if (!android.os.Environment.isExternalStorageManager()) {
            try {
                const intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(android.net.Uri.parse('package:' + context.getPackageName()));
                activity.startActivity(intent);
                return false;
            } catch (e) {
                const intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                activity.startActivity(intent);
                return false;
            }
        }
        return true;
    }
    
    return false;
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
        console.log('[FILE_DISCOVERY] Error getting PDF directory:', e);
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
        console.log('[FILE_DISCOVERY] Error getting Image directory:', e);
    }
    return null;
}

/**
 * Check if a file has already been imported
 */
async function isFileAlreadyImported(filePath: string): Promise<boolean> {
    try {
        const documentsService = getDocumentsService();
        if (!documentsService) {
            console.log('[FILE_DISCOVERY] isFileAlreadyImported: documentsService not available');
            return false;
        }
        
        const docs = await documentsService.documentRepository.search();
        console.log('[FILE_DISCOVERY] isFileAlreadyImported: checking against', docs.length, 'existing docs');
        
        for (const doc of docs) {
            if (doc.extra?.importedPdfPath === filePath) {
                console.log('[FILE_DISCOVERY] isFileAlreadyImported: FOUND MATCH in extra.importedPdfPath');
                return true;
            }
            if (doc.pages) {
                for (const page of doc.pages) {
                    if (page.sourceImagePath === filePath || page.imagePath === filePath) {
                        console.log('[FILE_DISCOVERY] isFileAlreadyImported: FOUND MATCH in page paths');
                        return true;
                    }
                }
            }
        }
        console.log('[FILE_DISCOVERY] isFileAlreadyImported: no match found for', filePath);
        return false;
    } catch (e) {
        console.log('[FILE_DISCOVERY] isFileAlreadyImported error:', e);
        return false;
    }
}

/**
 * Import an image file as a new document
 */
async function importImageAsDocument(imagePath: string): Promise<OCRDocument | null> {
    try {
        console.log('[FILE_DISCOVERY] === importImageAsDocument START ===');
        console.log('[FILE_DISCOVERY] Image path:', imagePath);
        
        if (await isFileAlreadyImported(imagePath)) {
            console.log('[FILE_DISCOVERY] Image already imported, skipping');
            return null;
        }
        
        const fileName = imagePath.split('/').pop() || 'Imported Image';
        console.log('[FILE_DISCOVERY] File name:', fileName);
        
        console.log('[FILE_DISCOVERY] Getting image size...');
        const imageSize = await getImageSize(imagePath);
        console.log('[FILE_DISCOVERY] Image size result:', JSON.stringify(imageSize));
        
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
        
        console.log('[FILE_DISCOVERY] Page data created:', JSON.stringify(pageData));
        
        console.log('[FILE_DISCOVERY] Creating document...');
        const doc = await OCRDocument.createDocument([pageData], undefined, { 
            name: fileName.replace(/\.[^/.]+$/, '') 
        });
        
        console.log('[FILE_DISCOVERY] Document created successfully!');
        console.log('[FILE_DISCOVERY] Doc ID:', doc.id);
        console.log('[FILE_DISCOVERY] Doc name:', doc.name);
        console.log('[FILE_DISCOVERY] Doc pages:', doc.pages?.length || 0);
        
        // Verify document was saved
        const documentsService = getDocumentsService();
        if (documentsService) {
            const verifyDoc = await documentsService.documentRepository.getById(doc.id);
            console.log('[FILE_DISCOVERY] Verification - doc exists in DB:', !!verifyDoc);
        }
        
        return doc;
    } catch (error) {
        console.error('[FILE_DISCOVERY] importImageAsDocument ERROR:', error);
        console.error('[FILE_DISCOVERY] Error stack:', error?.stack);
        return null;
    }
}

/**
 * Convert PDF to images using Android PdfRenderer directly
 * This avoids the "no content provider" issue
 */
async function convertPdfToImages(pdfPath: string): Promise<string[]> {
    if (!__ANDROID__) return [];
    
    const images: string[] = [];
    let fileDescriptor: android.os.ParcelFileDescriptor = null;
    let renderer: android.graphics.pdf.PdfRenderer = null;
    
    try {
        console.log('[FILE_DISCOVERY] Converting PDF using PdfRenderer:', pdfPath);
        
        const javaFile = new java.io.File(pdfPath);
        if (!javaFile.exists()) {
            console.error('[FILE_DISCOVERY] PDF file does not exist:', pdfPath);
            return [];
        }
        
        fileDescriptor = android.os.ParcelFileDescriptor.open(javaFile, android.os.ParcelFileDescriptor.MODE_READ_ONLY);
        if (!fileDescriptor) {
            console.error('[FILE_DISCOVERY] Could not open PDF file descriptor');
            return [];
        }
        
        renderer = new android.graphics.pdf.PdfRenderer(fileDescriptor);
        const pageCount = renderer.getPageCount();
        console.log('[FILE_DISCOVERY] PDF has', pageCount, 'pages');
        
        for (let i = 0; i < pageCount; i++) {
            console.log('[FILE_DISCOVERY] Rendering page', i);
            const page = renderer.openPage(i);
            
            // Get page dimensions
            const width = page.getWidth();
            const height = page.getHeight();
            console.log('[FILE_DISCOVERY] Page', i, 'dimensions:', width, 'x', height);
            
            // Scale for better quality (2x)
            const scale = 2;
            const scaledWidth = width * scale;
            const scaledHeight = height * scale;
            
            // Create bitmap
            const bitmap = android.graphics.Bitmap.createBitmap(scaledWidth, scaledHeight, android.graphics.Bitmap.Config.ARGB_8888);
            
            // Render page to bitmap
            page.render(bitmap, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            page.close();
            
            // Save bitmap to temp file
            const tempDir = Utils.android.getApplicationContext().getCacheDir();
            const imageFile = new java.io.File(tempDir, 'pdf_page_' + Date.now() + '_' + i + '.png');
            const outputStream = new java.io.FileOutputStream(imageFile);
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, outputStream);
            outputStream.flush();
            outputStream.close();
            bitmap.recycle();
            
            const imagePath = imageFile.getAbsolutePath();
            images.push(imagePath);
            console.log('[FILE_DISCOVERY] Saved page', i, 'to:', imagePath);
        }
        
        console.log('[FILE_DISCOVERY] PDF conversion complete, created', images.length, 'images');
        
    } catch (error) {
        console.error('[FILE_DISCOVERY] PdfRenderer error:', error);
        console.error('[FILE_DISCOVERY] Error stack:', error?.stack);
    } finally {
        if (renderer) {
            try { renderer.close(); } catch (e) {}
        }
        if (fileDescriptor) {
            try { fileDescriptor.close(); } catch (e) {}
        }
    }
    
    return images;
}

/**
 * Import a PDF file as a new document
 */
async function importPdfAsDocument(pdfPath: string): Promise<OCRDocument | null> {
    try {
        console.log('[FILE_DISCOVERY] === importPdfAsDocument START ===');
        console.log('[FILE_DISCOVERY] PDF path:', pdfPath);
        
        if (await isFileAlreadyImported(pdfPath)) {
            console.log('[FILE_DISCOVERY] PDF already imported, skipping');
            return null;
        }
        
        const fileName = pdfPath.split('/').pop() || 'Imported PDF';
        console.log('[FILE_DISCOVERY] File name:', fileName);
        
        // Convert PDF to images using PdfRenderer
        console.log('[FILE_DISCOVERY] Converting PDF to images...');
        const pdfImages = await convertPdfToImages(pdfPath);
        console.log('[FILE_DISCOVERY] PDF conversion result:', pdfImages?.length || 0, 'images');
        
        if (!pdfImages || pdfImages.length === 0) {
            console.log('[FILE_DISCOVERY] No images from PDF, creating reference-only document');
            const doc = await OCRDocument.createDocument([], undefined, {
                name: fileName.replace(/\.[^/.]+$/, ''),
                extra: {
                    importedPdfPath: pdfPath,
                    importedType: 'pdf'
                }
            });
            console.log('[FILE_DISCOVERY] Reference document created:', doc.id);
            return doc;
        }
        
        // Create pages from extracted images
        const pagesData: PageData[] = [];
        for (let i = 0; i < pdfImages.length; i++) {
            const imagePath = pdfImages[i];
            console.log('[FILE_DISCOVERY] Processing PDF page', i, ':', imagePath);
            
            try {
                const imageSize = await getImageSize(imagePath);
                console.log('[FILE_DISCOVERY] Page', i, 'size:', imageSize.width, 'x', imageSize.height);
                
                pagesData.push({
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
                });
            } catch (e) {
                console.error('[FILE_DISCOVERY] Error processing PDF page', i, ':', e);
            }
        }
        
        console.log('[FILE_DISCOVERY] Total pages data created:', pagesData.length);
        
        if (pagesData.length === 0) {
            console.log('[FILE_DISCOVERY] No valid pages, returning null');
            return null;
        }
        
        console.log('[FILE_DISCOVERY] Creating document with', pagesData.length, 'pages...');
        const doc = await OCRDocument.createDocument(pagesData, undefined, {
            name: fileName.replace(/\.[^/.]+$/, '')
        });
        
        console.log('[FILE_DISCOVERY] PDF Document created!');
        console.log('[FILE_DISCOVERY] Doc ID:', doc.id);
        console.log('[FILE_DISCOVERY] Doc name:', doc.name);
        console.log('[FILE_DISCOVERY] Doc pages:', doc.pages?.length || 0);
        
        return doc;
    } catch (error) {
        console.error('[FILE_DISCOVERY] importPdfAsDocument ERROR:', error);
        console.error('[FILE_DISCOVERY] Error stack:', error?.stack);
        return null;
    }
}

/**
 * List files in a directory
 */
function listFilesInDirectory(dirPath: string): string[] {
    const files: string[] = [];
    try {
        console.log('[FILE_DISCOVERY] Listing files in:', dirPath);
        const javaFile = new java.io.File(dirPath);
        
        console.log('[FILE_DISCOVERY] Directory exists:', javaFile.exists());
        console.log('[FILE_DISCOVERY] Is directory:', javaFile.isDirectory());
        console.log('[FILE_DISCOVERY] Can read:', javaFile.canRead());
        
        if (!javaFile.exists() || !javaFile.isDirectory()) {
            return files;
        }
        
        const children = javaFile.listFiles();
        if (children) {
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (child.isFile()) {
                    files.push(child.getAbsolutePath());
                }
            }
        }
        console.log('[FILE_DISCOVERY] Files found:', files.length);
    } catch (e) {
        console.error('[FILE_DISCOVERY] Error listing directory:', e);
    }
    return files;
}

/**
 * Discover existing files in export directories
 */
export async function discoverExistingFiles(): Promise<number> {
    console.log('[FILE_DISCOVERY] ========== STARTING FILE DISCOVERY ==========');
    
    if (!__ANDROID__) {
        console.log('[FILE_DISCOVERY] Not Android, skipping');
        return 0;
    }

    const hasPermission = hasStoragePermission();
    console.log('[FILE_DISCOVERY] Has storage permission:', hasPermission);
    
    if (!hasPermission) {
        console.log('[FILE_DISCOVERY] Requesting permission...');
        await requestStoragePermission();
        return 0;
    }

    let importedCount = 0;

    try {
        const pdfDir = getPdfExportDirectory();
        const imageDir = getImageExportDirectory();
        
        console.log('[FILE_DISCOVERY] PDF directory:', pdfDir);
        console.log('[FILE_DISCOVERY] Image directory:', imageDir);

        // Check documentsService state
        const documentsService = getDocumentsService();
        console.log('[FILE_DISCOVERY] DocumentsService available:', !!documentsService);
        console.log('[FILE_DISCOVERY] DocumentsService started:', documentsService?.started);
        
        if (documentsService) {
            const existingDocs = await documentsService.documentRepository.search();
            console.log('[FILE_DISCOVERY] Existing documents in DB:', existingDocs.length);
        }

        // Process Images
        if (imageDir) {
            console.log('[FILE_DISCOVERY] --- Scanning Image directory ---');
            const imageFiles = listFilesInDirectory(imageDir);
            
            for (const imagePath of imageFiles) {
                const ext = imagePath.toLowerCase();
                if (ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp')) {
                    const doc = await importImageAsDocument(imagePath);
                    if (doc) {
                        importedCount++;
                    }
                }
            }
        }

        // Process PDFs
        if (pdfDir) {
            console.log('[FILE_DISCOVERY] --- Scanning PDF directory ---');
            const pdfFiles = listFilesInDirectory(pdfDir);
            
            for (const pdfPath of pdfFiles) {
                if (pdfPath.toLowerCase().endsWith('.pdf')) {
                    const doc = await importPdfAsDocument(pdfPath);
                    if (doc) {
                        importedCount++;
                    }
                }
            }
        }

        // Final verification
        if (documentsService) {
            const finalDocs = await documentsService.documentRepository.search();
            console.log('[FILE_DISCOVERY] Final document count in DB:', finalDocs.length);
        }

        console.log('[FILE_DISCOVERY] ========== DISCOVERY COMPLETE. Imported:', importedCount, '==========');
        
    } catch (error) {
        console.error('[FILE_DISCOVERY] Discovery error:', error);
        console.error('[FILE_DISCOVERY] Error stack:', error?.stack);
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
