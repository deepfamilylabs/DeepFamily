import { describe, it, expect } from 'vitest'
import { getInvalidateKeysAfterPersonVersionAdded } from './treeInvalidation'
import { makeNodeId } from '../types/graph'
import { unionParentKey } from '../types/treeStore'

const sort = (items: string[]) => [...items].sort()

describe('treeInvalidation getInvalidateKeysAfterPersonVersionAdded', () => {
  it('builds invalidation keys for child and parents', () => {
    const ev = {
      personHash: '0xchild',
      versionIndex: 1,
      fatherHash: '0xfather',
      fatherVersionIndex: 2,
      motherHash: '0xmother',
      motherVersionIndex: 3
    }
    const out = getInvalidateKeysAfterPersonVersionAdded(ev)
    expect(sort(out.totalVersionsKeys)).toEqual(sort([
      'tv:0xchild',
      'tv:0xfather',
      'tv:0xmother'
    ]))
    expect(sort(out.unionKeys)).toEqual(sort([
      unionParentKey('0xfather'),
      unionParentKey('0xmother')
    ]))
    expect(sort(out.strictKeys)).toEqual(sort([
      makeNodeId('0xfather', 2),
      makeNodeId('0xmother', 3)
    ]))
    expect(out.strictPrefixes).toEqual([])
  })

  it('uses strict prefixes when parent version is missing/invalid', () => {
    const ev = {
      personHash: '0xchild',
      versionIndex: 1,
      fatherHash: '0xfather',
      fatherVersionIndex: undefined,
      motherHash: '0xmother',
      motherVersionIndex: 0
    }
    const out = getInvalidateKeysAfterPersonVersionAdded(ev)
    expect(sort(out.unionKeys)).toEqual(sort([
      unionParentKey('0xfather'),
      unionParentKey('0xmother')
    ]))
    expect(out.strictKeys).toEqual([])
    expect(sort(out.strictPrefixes)).toEqual(sort([
      '0xfather-v-',
      '0xmother-v-'
    ]))
  })

  it('skips zero hashes', () => {
    const ev = {
      personHash: '0xchild',
      versionIndex: 1,
      fatherHash: '0x',
      fatherVersionIndex: 1,
      motherHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      motherVersionIndex: 2
    }
    const out = getInvalidateKeysAfterPersonVersionAdded(ev)
    expect(out.unionKeys).toEqual([])
    expect(out.strictKeys).toEqual([])
    expect(out.strictPrefixes).toEqual([])
    expect(out.totalVersionsKeys).toEqual(['tv:0xchild'])
  })
})
