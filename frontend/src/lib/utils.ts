import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn's cn(): clsx for conditional classes, tailwind-merge so caller
// overrides beat component defaults.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
