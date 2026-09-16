import type { DocumentModel } from '../model/document.js';
import { RELATIONSHIP_TYPE_IMAGE } from '../ooxml/namespaces.js';
import type { RenderImageProvider, RenderImageSource } from '../render/images.js';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

const mimeOf = (target: string): string => {
  const extension = target.slice(target.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
};

export interface PackageImageProviderOptions {
  readonly current: () => DocumentModel | undefined;
  readonly onHydrated?: (() => void) | undefined;
}

export const createPackageImageProvider = (
  options: PackageImageProviderOptions,
): RenderImageProvider => {
  let cached: Map<string, Uint8Array> | undefined;
  let cachedFor: DocumentModel | undefined;
  let hydrating = false;

  const cacheFor = (model: DocumentModel): Map<string, Uint8Array> => {
    if (cachedFor !== model || cached === undefined) {
      cachedFor = model;
      cached = new Map();
    }
    return cached;
  };

  const relationshipFor = (
    model: DocumentModel,
    id: string,
  ): { readonly target: string } | undefined => {
    const pkg = model.package;
    // Relationship ids are only unique within their source part, so an id has to be matched
    // against that part's image relationships rather than against every relationship in the package.
    for (const sourcePartName of pkg.relationships.sourceParts()) {
      const images = pkg.relationships.getRelationships(sourcePartName, RELATIONSHIP_TYPE_IMAGE);
      const found = images.find((candidate) => candidate.id === id);
      if (found !== undefined) return { target: found.resolvedTarget };
    }
    return undefined;
  };

  const hydrate = (model: DocumentModel): void => {
    if (hydrating) return;
    const cache = cacheFor(model);
    const pkg = model.package;
    hydrating = true;
    void (async (): Promise<void> => {
      let gained = false;
      for (const sourcePartName of pkg.relationships.sourceParts()) {
        for (const relationship of pkg.relationships.getRelationships(
          sourcePartName,
          RELATIONSHIP_TYPE_IMAGE,
        )) {
          if (cache.has(relationship.resolvedTarget)) continue;
          const part = pkg.getPart(relationship.resolvedTarget);
          if (part === undefined) continue;
          try {
            cache.set(relationship.resolvedTarget, await part.bytes());
            gained = true;
          } catch {
            continue;
          }
        }
      }
      hydrating = false;
      if (gained) options.onHydrated?.();
    })();
  };

  return (id: string): RenderImageSource | undefined => {
    const model = options.current();
    if (model === undefined) return undefined;
    const relationship = relationshipFor(model, id);
    if (relationship === undefined) return undefined;
    const cache = cacheFor(model);
    const part = model.package.getPart(relationship.target);
    if (part === undefined) return undefined;
    // a part the editing layer has written is re-read rather than served from the
    // cache, which is what makes replacing a picture show the new bytes
    let bytes = part.isDirty ? undefined : cache.get(relationship.target);
    if (bytes === undefined) {
      try {
        bytes = part.toBytes();
        cache.set(relationship.target, bytes);
      } catch {
        hydrate(model);
        return undefined;
      }
    }
    if (bytes.byteLength === 0) return undefined;
    return { id, bytes, mimeType: mimeOf(relationship.target) };
  };
};
