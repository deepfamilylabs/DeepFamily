export const isAddress = (v: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(v.trim());

export const isHash32 = (v: string): boolean => /^0x[a-fA-F0-9]{64}$/.test(v.trim());

export const isUrl = (v: string): boolean => /^https?:\/\//i.test(v) || v.startsWith("/");
