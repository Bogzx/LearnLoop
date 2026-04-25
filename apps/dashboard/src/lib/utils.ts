import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn/ui className helper. Combines conditional class lists
// (clsx) with tailwind-merge so duplicate Tailwind utilities resolve.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
