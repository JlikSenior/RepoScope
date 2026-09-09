export interface ParsedPackageVersion {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  build: string | null;
}

export interface ValidatedReleaseTag extends ParsedPackageVersion {
  tag: string;
  isPrerelease: boolean;
}

export function parsePackageVersion(version: string): ParsedPackageVersion;
export function expectedReleaseTag(version: string): string;
export function validateReleaseTag(version: string, tag: string): ValidatedReleaseTag;
