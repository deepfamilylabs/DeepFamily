declare module 'ipfs-only-hash' {
  interface Options {
    cidVersion?: 0 | 1
    rawLeaves?: boolean
    onlyHash?: boolean
  }

  export function of(
    content: string | Uint8Array,
    options?: Options
  ): Promise<string>

  const IpfsHash: {
    of: typeof of
  }

  export default IpfsHash
}

