export function findManagedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): { start: number; end: number } | undefined {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);

  if (start === -1 && end === -1) return undefined;
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Malformed RepoScope managed block: ${startMarker}`);
  }
  if (
    content.indexOf(startMarker, start + startMarker.length) !== -1 ||
    content.indexOf(endMarker, end + endMarker.length) !== -1
  ) {
    throw new Error(`Duplicate RepoScope managed block: ${startMarker}`);
  }

  return {
    start,
    end: end + endMarker.length,
  };
}

export function withoutManagedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string {
  const managed = findManagedBlock(content, startMarker, endMarker);
  if (!managed) return content;

  return `${content.slice(0, managed.start)}${content.slice(managed.end)}`;
}

export function upsertManagedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
  body: string,
): string {
  const normalizedBlock = `${startMarker}\n${body.trim()}\n${endMarker}`;
  const managed = findManagedBlock(content, startMarker, endMarker);

  if (managed) {
    return `${content.slice(0, managed.start)}${normalizedBlock}${content.slice(managed.end)}`;
  }

  const existing = content.trimEnd();
  return existing ? `${existing}\n\n${normalizedBlock}\n` : `${normalizedBlock}\n`;
}
