import * as vscode from 'vscode';
import _ from 'lodash';
import { ResourceFile, ResourceUploader, UploadDestination } from './common.mjs';
import { ResourceFileLoader } from './loader.mjs';
import { S3Uploader } from './s3Uploader.mjs';
import { WorkspaceUploader } from './workspaceUploader.mjs';
import { inspectDataTransfer } from './utils.mjs';
import { getLogger } from './logger.mjs';

const resourceUploadKind = vscode.DocumentDropOrPasteEditKind.Empty.append('resource-upload');

class ResourceUploadDocumentPasteEdit extends vscode.DocumentPasteEdit {
    constructor(
        public readonly files: ResourceFile[],
        public readonly documentUri: vscode.Uri,
        public readonly languageId: string,
        public readonly ranges: readonly vscode.Range[],
    ) {
        super("", "Upload resource files", resourceUploadKind);
    }
}

class ResourceUploadDocumentDropEdit extends vscode.DocumentDropEdit {
    constructor(
        public readonly files: ResourceFile[],
        public readonly documentUri: vscode.Uri,
        public readonly languageId: string,
        public readonly ranges: readonly vscode.Range[],
    ) {
        super("", "Upload resource files", resourceUploadKind);
    }
}

export class ResourcePasteOrDropProvider implements vscode.DocumentPasteEditProvider<ResourceUploadDocumentPasteEdit>, vscode.DocumentDropEditProvider<ResourceUploadDocumentDropEdit> {
    loaders: { [languageId: string]: ResourceFileLoader } = {};
    uploaders: { [key: string]: ResourceUploader } = {};
    undoHistory: [string, () => Thenable<void>][] = [];
    undoLimit = vscode.workspace.getConfiguration('pasteS3').get<number>('undoLimit') ?? 10;
    
    constructor(private context: vscode.ExtensionContext) {
        const logger = getLogger();
        logger.info(`ResourcePasteOrDropProvider created`);
        this.logConfiguration();
    }

    private logConfiguration() {
        const logger = getLogger();
        const config = vscode.workspace.getConfiguration('pasteS3');
        const s3Config = config.get<any>('s3') || {};
        
        const dump = {
            s3: {
                ...s3Config,
                accessKeyId: s3Config.accessKeyId ? '******' : undefined,
                secretAccessKey: s3Config.secretAccessKey ? '******' : undefined
            },
            workspace: config.get('workspace'),
            uploadDestination: config.get('uploadDestination'),
            enabled: config.get('enabled'),
            fileSizeLimit: config.get('fileSizeLimit'),
            allowMultipleFiles: config.get('allowMultipleFiles'),
            mimeTypeDetectionMethod: config.get('mimeTypeDetectionMethod'),
            keepOriginalFilename: config.get('keepOriginalFilename'),
            fileNamingMethod: config.get('fileNamingMethod'),
            defaultSnippet: config.get('defaultSnippet'),
            imageSnippet: config.get('imageSnippet'),
            undoLimit: config.get('undoLimit'),
            mimeTypeFilter: config.get('mimeTypeFilter'),
            ignoreWorkspaceFiles: config.get('ignoreWorkspaceFiles'),
            retrieveOriginalImage: config.get('retrieveOriginalImage')
        };
        logger.info(`Effective Configuration: ${JSON.stringify(dump)}`);
    }

    private getLoader(languageId: string): ResourceFileLoader {
        if (!this.loaders[languageId]) {
            this.loaders[languageId] = new ResourceFileLoader(languageId);
        }
        return this.loaders[languageId];
    }

    private getUploader(key: UploadDestination) {
        if (!this.uploaders[key]) {
            switch (key) {
                case 's3':
                    this.uploaders[key] = new S3Uploader(this.context);
                    break;
                case 'workspace':
                    this.uploaders[key] = new WorkspaceUploader(this.context);
                    break;
                default:
                    throw new Error(`Unknown upload destination ${key}`);
            }
        }
        return this.uploaders[key];
    }

    private isTextEditorDocument(document: vscode.TextDocument): boolean {
        const uri = document.uri.toString();
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor?.document.uri.toString() !== uri) {
            return false;
        }

        if (activeEditor.viewColumn === undefined) {
            return false;
        }

        return vscode.window.visibleTextEditors.some(editor =>
            editor.viewColumn !== undefined &&
            editor.document.uri.toString() === uri
        );
    }

    public async provideDocumentDropEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<ResourceUploadDocumentDropEdit[] | undefined> {
        const logger = getLogger();
        logger.debug('provideDocumentDropEdits called for', document.languageId);
        if (!this.isTextEditorDocument(document)) {
            logger.debug(`Skipping drop outside a visible text editor: ${document.uri.toString()}`);
            return undefined;
        }
        inspectDataTransfer(dataTransfer);
        const loader = this.getLoader(document.languageId);
        const files = await loader.prepareFilesToUpload(dataTransfer);
        if (files.length === 0) {
            logger.debug('No files to upload from drop operation');
            return undefined;
        }
        logger.info(`Preparing to upload ${files.length} file(s) from drop operation`);
        const edit = new ResourceUploadDocumentDropEdit(files, document.uri, document.languageId, [new vscode.Range(position, position)]);
        await this.executeUpload(edit);
        return [edit];
    }

    public async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken,
    ): Promise<ResourceUploadDocumentPasteEdit[] | undefined> {
        const logger = getLogger();
        logger.debug('provideDocumentPasteEdits called for', document.languageId);
        if (!this.isTextEditorDocument(document)) {
            logger.debug(`Skipping paste outside a visible text editor: ${document.uri.toString()}`);
            return undefined;
        }
        inspectDataTransfer(dataTransfer);
        const loader = this.getLoader(document.languageId);
        const files = await loader.prepareFilesToUpload(dataTransfer);
        if (files.length === 0) {
            logger.debug('No files to upload from paste operation');
            return undefined;
        }
        logger.info(`Preparing to upload ${files.length} file(s) from paste operation`);
        return [new ResourceUploadDocumentPasteEdit(files, document.uri, document.languageId, ranges)];
    }

    async executeUpload(edit: ResourceUploadDocumentDropEdit | ResourceUploadDocumentPasteEdit) {
        const logger = getLogger();
        const loader = this.getLoader(edit.languageId);
        const workspaceEdit = new vscode.WorkspaceEdit();
        const uploader = this.getUploader(loader.getUploadDestination());
        logger.info(`Starting upload of ${edit.files.length} file(s) using ${loader.getUploadDestination()} uploader`);
        const snippets: string[] = [];
        for (const file of edit.files) {
            try {
                logger.debug(`Uploading file: ${file.name}.${file.extension} (${file.data.length} bytes, ${file.mime})`);
                const result = await uploader.uploadFile(file, edit.documentUri, workspaceEdit);
                snippets.push(loader.generateSnippet(file, result.uri));
                
                if (result.isCacheHit) {
                    logger.info(`Resolved from cache: ${file.name}.${file.extension} -> ${result.uri}`);
                } else {
                    logger.info(`Successfully uploaded: ${file.name}.${file.extension} -> ${result.uri}`);
                }

                if (result.undo) {
                    this.undoHistory.push([result.undoTitle ?? file.name, result.undo]);
                    if (this.undoHistory.length > this.undoLimit) {
                        this.undoHistory.shift();
                    }
                }
            } catch (e) {
                logger.error(`Failed to upload ${file.name}`, e);
                vscode.window.showErrorMessage(`Failed to upload ${file.name}: ${e}`);
            }
        }
        const snippet = snippets.join(' ');
        workspaceEdit.set(edit.documentUri, edit.ranges.map(r => new vscode.SnippetTextEdit(r, new vscode.SnippetString(snippet))));
        edit.additionalEdit = workspaceEdit;
    }

    public async resolveDocumentDropEdit(edit: ResourceUploadDocumentDropEdit, token: vscode.CancellationToken): Promise<ResourceUploadDocumentDropEdit> {
        // FIXME: VS Code never calls this method
        const logger = getLogger();
        logger.debug('Calling resolveDocumentDropEdit');
        // await this.executeUpload(edit);
        return edit;
    }

    public async resolveDocumentPasteEdit(edit: ResourceUploadDocumentPasteEdit, token: vscode.CancellationToken): Promise<ResourceUploadDocumentPasteEdit> {
        await this.executeUpload(edit);
        return edit;
    }

    async showUndoMenu() {
        const logger = getLogger();
        const items = this.undoHistory.map(([title, undo], index) => ({
            label: title,
            index,
        }));
        if (items.length === 0) {
            logger.debug('No recent upload to undo');
            vscode.window.showInformationMessage('No recent upload to undo');
            return;
        }
        const item = await vscode.window.showQuickPick(items, {
            title: 'Undo recent upload',
            placeHolder: 'Select an upload to undo',
        });
        if (item) {
            const [title, undo] = this.undoHistory[item.index];
            try {
                logger.info(`Undoing upload: ${title}`);
                await undo();
                vscode.window.showInformationMessage(`Undo ${title} successfully`);
                this.undoHistory.splice(item.index, 1);
                logger.info(`Successfully undone: ${title}`);
            } catch (e) {
                logger.error(`Failed to undo ${title}`, e);
                vscode.window.showErrorMessage(`Failed to undo ${title}: ${e}`);
            }
        }
    }

    public register(): vscode.Disposable {
        return vscode.Disposable.from(
            vscode.languages.registerDocumentDropEditProvider({ pattern: "**" }, this, {
                providedDropEditKinds: [resourceUploadKind],
                dropMimeTypes: ['files', 'text/uri-list', 'image/*']
            }),
            vscode.languages.registerDocumentPasteEditProvider({ pattern: "**" }, this, {
                providedPasteEditKinds: [resourceUploadKind],
                pasteMimeTypes: ['files', 'text/uri-list', 'image/*']
            }),
            vscode.commands.registerCommand('paste-s3.undoRecentUpload', () => this.showUndoMenu()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('pasteS3')) {
                    const logger = getLogger();
                    this.undoLimit = vscode.workspace.getConfiguration('pasteS3').get<number>('undoLimit') ?? 10;
                    logger.info(`Configuration changed, reloading loaders and uploaders. New undoLimit=${this.undoLimit}`);
                    this.logConfiguration();
                    while (this.undoHistory.length > this.undoLimit) {
                        this.undoHistory.shift();
                    }
                    this.loaders = {};
                    this.uploaders = {};
                }
            })
        );
    }
}
