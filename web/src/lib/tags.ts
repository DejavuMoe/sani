import type { TagColor } from './api';

export const TAG_LIMIT = 5;
export const TAG_NAME_LIMIT = 24;
export const TAG_COLORS: TagColor[] = ['blue', 'green', 'amber', 'rose', 'neutral'];
export const tagKey = (name: string) => name.trim().normalize('NFC').toLowerCase();
