/** Typed entry point for the existing read-only backup validator; no deployment is executed. */
export function validateRestoreBundle(directory: string): Promise<{
  root: string;
  manifest: {format: string; project: string; postgresMajor: number; createdAt: string; files: Record<string, {sha256: string; size: number}>};
}>;
