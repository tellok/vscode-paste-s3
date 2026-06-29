declare module "md5.js" {
    export default class MD5 {
        constructor();
        update(data: Uint8Array): this;
        digest(type: "hex"): string;
    }
}

declare module "heic-convert" {
    export default function convert(options: {
        buffer: Uint8Array;
        format: "PNG";
    }): Promise<Uint8Array>;
}
