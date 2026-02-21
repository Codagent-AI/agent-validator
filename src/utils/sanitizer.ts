export function sanitizeJobId(jobId: string): string {
  return jobId.replace(/[^a-zA-Z0-9._-]/g, '_');
}
