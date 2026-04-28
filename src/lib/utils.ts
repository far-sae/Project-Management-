import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function generateId() {
  return crypto.randomUUID();
}

export function formatDate(date: Date | string | number) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Relative time for comments/activity; avoids "Invalid Date" when value is missing or bad. */
export function formatDistanceSafe(
  createdAt: Date | string | number | null | undefined,
  fallback = "Unknown",
): string {
  if (createdAt == null) return fallback;
  const d =
    createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return fallback;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return fallback;
  }
}

export function formatNumber(num: number) {
  return new Intl.NumberFormat("en-US").format(num);
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy text: ", err);
    return false;
  }
}

export const truncateFileName = (
  fileName: string,
  maxLength: number = 30,
): string => {
  if (fileName.length <= maxLength) return fileName;

  const extension = fileName.split(".").pop() || "";
  const nameWithoutExt = fileName.slice(
    0,
    fileName.length - extension.length - 1,
  );

  if (extension) {
    const truncatedName = nameWithoutExt.slice(
      0,
      maxLength - extension.length - 3,
    );
    return `${truncatedName}...${extension}`;
  }

  return `${fileName.slice(0, maxLength - 3)}...`;
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};
