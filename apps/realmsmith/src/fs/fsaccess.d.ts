// The File System Access *permission* methods are not in the standard lib.dom
// types (they're a non-standard extension Chromium ships). Augment the handle so
// the editor can query/request read-write permission without `any`.
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }
  interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
  interface Window {
    // Not in this TS lib.dom version; declared with an inline options type to avoid
    // colliding with any built-in OpenFilePickerOptions.
    showOpenFilePicker(options?: {
      multiple?: boolean;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle[]>;
  }
}
