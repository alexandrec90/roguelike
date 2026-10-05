/**
 * WebGPU's usage and stage flags, as the spec numbers them.
 *
 * The browser defines these as globals (`GPUBufferUsage.STORAGE`, …), and
 * TypeScript's DOM library declares WebGPU's interfaces but not these
 * namespaces. Rather than take a dependency (`@webgpu/types`) for a dozen
 * constants, they are here, with the values the spec fixes.
 */

export const BufferUsage = {
  COPY_DST: 0x0008,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

export const TextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
} as const;

export const ShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
} as const;
