import * as vscode from 'vscode';

export interface ResourceFile {
    mime: string;
    name: string;
    extension: string;
    data: Buffer;
    originalName?: string;
    originalExtension?: string;
}

export interface IncompleteResourceFile {
    mime?: string;
    name?: string;
    extension?: string;
    data: Buffer;
}

export type MimeTypeDetectionMethod = 'content' | 'extension' | 'none';
export type FileNamingMethod = 'md5' | 'md5Short' | 'uuid' | 'nanoid' | 'unixTimestamp' | 'readableTimestamp' | 'prompt';
export type AllowMultipleFiles = 'allow' | 'deny' | 'prompt';
export type UploadDestination = 's3' | 'workspace';
export interface ResourceFileLoaderOptions {
    enabled: boolean;
    uploadDestination: UploadDestination;
    fileSizeLimit: number;
    mimeTypeDetectionMethod: MimeTypeDetectionMethod;
    keepOriginalFilename: boolean;
    fileNamingMethod: FileNamingMethod;
    defaultSnippet: string;
    imageSnippet: string;
    allowMultipleFiles: AllowMultipleFiles;
    mimeTypeFilter: string;
    ignoreWorkspaceFiles: boolean;
    retrieveOriginalImage: boolean;
    convertHeicToPng: boolean;
}

export interface ResourceUploadResult {
    uri: string;
    undoTitle?: string;
    undo?: () => Thenable<void>;
    isCacheHit?: boolean;
}

export interface ResourceUploader {
    uploadFile(file: ResourceFile, doucumentUri: vscode.Uri, edit: vscode.WorkspaceEdit): Promise<ResourceUploadResult>;
}

export interface S3Options {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket: string;
    prefix?: string;
    publicUrlBase?: string;
    omitExtension?: boolean;
    skipExisting?: boolean;
    forcePathStyle?: boolean;
    clientOptions?: Record<string, any>;
}

export interface WorkspaceOptions {
    path: string;
    linkBase: string;
}
