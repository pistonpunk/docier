import { concatBytes } from '../bytes.js';
import { DocierError } from '../errors.js';

export const RAW_DEFLATE_FORMAT = 'deflate-raw';

export const DEFLATE_LEVEL = 6;

export type DeflateFlavour = 'pinned' | 'native';

export interface DeflateBackend {
  readonly name: string;
  readonly flavour: DeflateFlavour;
  readonly deflateRaw: (data: Uint8Array) => Promise<Uint8Array>;
  readonly inflateRaw: (data: Uint8Array) => Promise<Uint8Array>;
  readonly inflateRawBounded?: (data: Uint8Array, maxBytes: number) => Promise<Uint8Array>;
}

export interface DeflateResolution {
  readonly backend: DeflateBackend;
  readonly deterministic: boolean;
}

interface DeflateStreamLike {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

interface DeflateStreamHost {
  readonly CompressionStream?: new (format: string) => DeflateStreamLike;
  readonly DecompressionStream?: new (format: string) => DeflateStreamLike;
}

const host = globalThis as unknown as DeflateStreamHost;

const limitExceeded = (maxBytes: number): DocierError =>
  new DocierError(`Decompressed data exceeds the configured limit of ${maxBytes} bytes`, {
    code: 'DOCUMENT_TOO_LARGE',
  });

const pump = async (
  stream: DeflateStreamLike,
  data: Uint8Array,
  maxBytes: number | undefined,
): Promise<Uint8Array> => {
  const writer = stream.writable.getWriter();
  const writePromise = writer
    .write(data)
    .then(() => writer.close())
    .catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (maxBytes !== undefined && total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw limitExceeded(maxBytes);
    }
    chunks.push(result.value);
  }
  await writePromise;
  return concatBytes(chunks);
};

const noBackend = (detail: string): DocierError =>
  new DocierError(
    `No DEFLATE backend is available in this environment (${detail}). Provide one through the deflate option.`,
    { code: 'NO_DEFLATE_BACKEND' },
  );

const runStream = (
  factory: (format: string) => DeflateStreamLike,
  data: Uint8Array,
  detail: string,
  code: 'ZIP_MALFORMED' | 'UNSUPPORTED_COMPRESSION',
  maxBytes: number | undefined = undefined,
): Promise<Uint8Array> => {
  let stream: DeflateStreamLike;
  try {
    stream = factory(RAW_DEFLATE_FORMAT);
  } catch {
    return Promise.reject(noBackend(detail));
  }
  return pump(stream, data, maxBytes).catch((error: unknown) => {
    if (error instanceof DocierError) throw error;
    throw new DocierError(`Raw DEFLATE failed: ${String(error)}`, { code, cause: error });
  });
};

export const hasPlatformDeflateSupport = (): boolean => {
  const Compressor = host.CompressionStream;
  const Decompressor = host.DecompressionStream;
  if (Compressor === undefined || Decompressor === undefined) return false;
  try {
    void new Compressor(RAW_DEFLATE_FORMAT);
    void new Decompressor(RAW_DEFLATE_FORMAT);
    return true;
  } catch {
    return false;
  }
};

export const createPlatformDeflateBackend = (): DeflateBackend | undefined => {
  const Compressor = host.CompressionStream;
  const Decompressor = host.DecompressionStream;
  if (Compressor === undefined || Decompressor === undefined) return undefined;
  if (!hasPlatformDeflateSupport()) return undefined;
  return {
    name: 'CompressionStream',
    flavour: 'native',
    deflateRaw: (data) =>
      runStream(
        (format) => new Compressor(format),
        data,
        'CompressionStream is present but not usable',
        'UNSUPPORTED_COMPRESSION',
      ),
    inflateRaw: (data) =>
      runStream(
        (format) => new Decompressor(format),
        data,
        'DecompressionStream is present but not usable',
        'ZIP_MALFORMED',
      ),
    inflateRawBounded: (data, maxBytes) =>
      runStream(
        (format) => new Decompressor(format),
        data,
        'DecompressionStream is present but not usable',
        'ZIP_MALFORMED',
        maxBytes,
      ),
  };
};

export const inflateRawWithLimit = async (
  backend: DeflateBackend,
  data: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> => {
  const bounded = backend.inflateRawBounded;
  const result =
    bounded === undefined ? await backend.inflateRaw(data) : await bounded.call(backend, data, maxBytes);
  if (result.byteLength > maxBytes) throw limitExceeded(maxBytes);
  return result;
};

let platformBackend: DeflateBackend | undefined;
let platformProbed = false;

export const getDeflateBackend = (): DeflateBackend => {
  if (!platformProbed) {
    platformProbed = true;
    platformBackend = createPlatformDeflateBackend();
  }
  const backend = platformBackend;
  if (backend === undefined) {
    throw noBackend('neither CompressionStream nor DecompressionStream accepts deflate-raw');
  }
  return backend;
};

let pinnedBackend: DeflateBackend | undefined;

export const setPinnedDeflateBackend = (backend: DeflateBackend | undefined): void => {
  pinnedBackend = backend;
};

export const getPinnedDeflateBackend = (): DeflateBackend | undefined => pinnedBackend;

export const resolveDeflateBackend = (flavour: DeflateFlavour = 'pinned'): DeflateResolution => {
  if (flavour === 'pinned' && pinnedBackend !== undefined) {
    return { backend: pinnedBackend, deterministic: pinnedBackend.flavour === 'pinned' };
  }
  const platform = getDeflateBackend();
  return { backend: platform, deterministic: platform.flavour === 'pinned' };
};
